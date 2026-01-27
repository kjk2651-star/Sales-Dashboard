import * as XLSX from "xlsx";
import { WeeklyData, SnapshotData, ParsedExcelResult } from "@/types/data";

export const parseExcel = async (file: File): Promise<ParsedExcelResult> => {
    return new Promise((resolve, reject) => {
        console.log("[ExcelParser] Started parsing file:", file.name);

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: "binary" });
                const sheetNames = workbook.SheetNames;
                console.log("[ExcelParser] Found Sheets:", sheetNames);

                // Helper: Normalize String for Values
                const normalize = (str: string) => str ? String(str).trim().toLowerCase() : "";

                // Helper: Strong Number Parser (Remove commas)
                const parseNum = (val: any): number => {
                    if (typeof val === 'number') return val;
                    if (typeof val === 'string') {
                        // Remove commas and whitespace
                        const cleanStr = val.replace(/,/g, '').trim();
                        if (cleanStr === '') return 0;
                        const parsed = parseFloat(cleanStr);
                        return isNaN(parsed) ? 0 : parsed;
                    }
                    return 0;
                };

                // --- 1. Weekly Channel Data Parsing ---
                let weeklyData: WeeklyData[] = [];
                const distributors = new Set<string>();

                const sellOutSheets = sheetNames.filter(name => normalize(name).includes("sell-out raw"));
                const invRawSheets = sheetNames.filter(name => normalize(name).includes("inventory raw"));

                // Key Finder Helper (Fuzzy for general raw sheets)
                const findKeyFuzzy = (row: any, candidates: string[]) => {
                    const rowKeys = Object.keys(row);
                    const normalizedCandidates = candidates.map(c => normalize(c));
                    for (const key of rowKeys) {
                        const normKey = normalize(key);
                        if (normalizedCandidates.some(c => normKey.includes(c))) {
                            return row[key];
                        }
                    }
                    return undefined;
                };

                const parseWeeklySheet = (sheetName: string, type: 'sales' | 'inventory') => {
                    const sheet = workbook.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json<any>(sheet);

                    if (rows.length > 0) {
                        console.log(`[ExcelParser] First Row Keys (${sheetName}):`, Object.keys(rows[0]));
                    }

                    rows.forEach((row, index) => {
                        let modelName = findKeyFuzzy(row, ['변환 model', '변환model']);
                        if (!modelName) modelName = findKeyFuzzy(row, ['item', 'model']);

                        if (!modelName) return;

                        let chipset = findKeyFuzzy(row, ['chipset']) || findKeyFuzzy(row, ['item group']) || "Unknown";
                        const product = findKeyFuzzy(row, ['product', '품목']) || "Unknown";
                        const distName = findKeyFuzzy(row, ['distisubname', '총판', '구분', 'partner']) || "Unknown";

                        const rawQty = findKeyFuzzy(row, ['qty', '수량', 'sales', 'quantity']);
                        const qty = parseNum(rawQty);

                        const yearRaw = findKeyFuzzy(row, ['year']) || 2024;
                        const year = Number(yearRaw);

                        const rawMonth = findKeyFuzzy(row, ['month', '월']);
                        let month = 0;
                        if (rawMonth) {
                            const mStr = String(rawMonth).replace(/월/g, '').trim();
                            month = Number(mStr);
                        }

                        const rawWeek = findKeyFuzzy(row, ['week', '주차', '주']);
                        let week = 0;
                        if (rawWeek !== undefined && rawWeek !== null) {
                            const wStr = String(rawWeek).replace(/[Ww주]/g, '').trim();
                            week = Number(wStr);
                        }

                        if (month === 0 && week > 0) {
                            month = Math.ceil(week / 4.35);
                            if (month > 12) month = 12;
                        }

                        const dealerName = findKeyFuzzy(row, ['변환 dealer', '변환dealer', 'dealer', '판매처']) || "Unknown";
                        const categoryType = findKeyFuzzy(row, ['type', '구분', '타입']) || "Unknown";

                        if (distName !== "Unknown") distributors.add(distName);

                        weeklyData.push({
                            distributor: distName,
                            modelName: String(modelName).trim(),
                            chipset: String(chipset).trim(),
                            qty,
                            year,
                            month,
                            week,
                            type,
                            dealerName: String(dealerName).trim(),
                            categoryType: String(categoryType).trim(),
                            product: String(product).trim()
                        });
                    });
                };

                sellOutSheets.forEach(sheet => parseWeeklySheet(sheet, 'sales'));
                invRawSheets.forEach(sheet => parseWeeklySheet(sheet, 'inventory'));


                // --- 2. Current Snapshot Data Parsing (Unified 2-Pass Strategy) ---
                const snapshotMap = new Map<string, SnapshotData>();
                let referenceWeek = "Unknown"; // Final reference week to return

                // [Step 1] Find Inventory Sheet (Strict: Contains 'inventory')
                const inventorySheetName = sheetNames.find(name =>
                    name.toLowerCase().includes('inventory')
                );

                if (inventorySheetName) {
                    console.log(`📂 Processing Inventory Sheet: ${inventorySheetName}`);
                    const sheet = workbook.Sheets[inventorySheetName];
                    const rawData = XLSX.utils.sheet_to_json<any>(sheet);

                    if (rawData.length > 0) {
                        const firstRow = rawData[0];
                        const keys = Object.keys(firstRow);

                        // Robust Key Finder (Whitespace-agnostic, Case-agnostic)
                        const findKey = (keyword: string) => keys.find(k => k.toUpperCase().replace(/\s/g, '').includes(keyword.toUpperCase()));

                        const yearKey = findKey('YEAR');
                        const weekKey = findKey('WEEK');
                        const modelKey = findKey('변환MODEL'); // Targets '변환 Model Name' etc.
                        const qtyKey = keys.find(k => k.toUpperCase().trim() === 'QTY'); // Strict QTY

                        // Optional Keys for granularity
                        const chipsetKey = findKey('CHIPSET') || findKey('ITEMGROUP');
                        const distKey = findKey('DISTRIBUTOR') || findKey('총판') || findKey('PARTNER');

                        if (yearKey && weekKey && modelKey && qtyKey) {

                            // --- [Pass 1] Find Max Week ---
                            let maxYear = 0;
                            let maxWeekNum = 0;
                            let maxWeekStr = "";

                            rawData.forEach((row: any) => {
                                const yVal = parseInt(String(row[yearKey]).replace(/\D/g, ''), 10) || 0;
                                const wVal = parseInt(String(row[weekKey]).replace(/\D/g, ''), 10) || 0;

                                if (yVal > maxYear) {
                                    maxYear = yVal;
                                    maxWeekNum = wVal;
                                    maxWeekStr = String(row[weekKey]);
                                } else if (yVal === maxYear && wVal > maxWeekNum) {
                                    maxWeekNum = wVal;
                                    maxWeekStr = String(row[weekKey]);
                                }
                            });

                            if (maxYear > 0) {
                                referenceWeek = `${maxYear}-${maxWeekStr}`;
                                console.log(`📅 Latest Inventory Date: ${referenceWeek} (Key: ${maxYear}, ${maxWeekNum})`);
                            }

                            // --- [Pass 2] Filter & Aggregate ---
                            let matchCount = 0;
                            rawData.forEach((row: any) => {
                                const yVal = parseInt(String(row[yearKey]).replace(/\D/g, ''), 10) || 0;
                                const wVal = parseInt(String(row[weekKey]).replace(/\D/g, ''), 10) || 0;

                                // Filter by Max Week
                                if (yVal === maxYear && wVal === maxWeekNum) {
                                    const rawModelName = row[modelKey];
                                    if (!rawModelName) return;

                                    // QTY Parsing (Handle commas explicitly)
                                    let qtyVal = row[qtyKey];
                                    if (typeof qtyVal === 'string') {
                                        qtyVal = parseFloat(qtyVal.replace(/,/g, ''));
                                    }
                                    const qty = Number(qtyVal) || 0;

                                    // Normalize Model Name for Aggregation Key
                                    // "RTX 3080 " -> "RTX3080"
                                    const normalizedKey = String(rawModelName).replace(/\s+/g, '').toUpperCase();

                                    // Extract Extras
                                    const chipset = chipsetKey ? (row[chipsetKey] || "Unknown") : "Unknown";
                                    const distributor = distKey ? (row[distKey] || "Intech") : "Intech";

                                    if (!snapshotMap.has(normalizedKey)) {
                                        snapshotMap.set(normalizedKey, {
                                            modelName: String(rawModelName).trim(), // Keep original name for display? Or normalized? User code implied 'normalizedKey' used for mapping. 
                                            // Let's store trimmed original for better readability, but allow aggregation by normalized.
                                            chipset: String(chipset).trim(),
                                            availableStock: 0,
                                            totalStock: 0,
                                            incomingQty: 0,
                                            incomingAmount: 0,
                                            distributor: String(distributor).trim()
                                        });
                                    }

                                    const entry = snapshotMap.get(normalizedKey)!;
                                    entry.availableStock += qty;
                                    entry.totalStock += qty;

                                    if (entry.chipset === "Unknown" && chipset !== "Unknown") entry.chipset = chipset;
                                    matchCount++;
                                }
                            });
                            console.log(`✅ Loaded ${matchCount} rows for week ${referenceWeek}`);
                        } else {
                            console.error("❌ Column Header Mismatch! Needed: YEAR, WEEK, 변환ModelName, QTY");
                            console.group("Found Keys:");
                            console.log(keys);
                            console.groupEnd();
                        }
                    }
                }

                // Legacy Fallback (Intech Inv)
                if (snapshotMap.size === 0) {
                    console.log("ℹ️ No 'Inventory' Data found/parsed. Checking Legacy Sheets...");

                    const intechInvSheetName = sheetNames.find(name => normalize(name).includes("intech inv"));
                    if (intechInvSheetName) {
                        const sheet = workbook.Sheets[intechInvSheetName];
                        const rows = XLSX.utils.sheet_to_json<any>(sheet);
                        rows.forEach(row => {
                            const modelName = row["Item"];
                            if (!modelName) return;

                            const safeName = String(modelName).trim(); // Just trim for legacy
                            const normalizedKey = safeName.replace(/\s+/g, '').toUpperCase();

                            const available = parseNum(row["정상가용"]);
                            const total = parseNum(row["합계수량"]);
                            const chipset = row["Item Group"] || row["Chipset"] || "Unknown";

                            if (!snapshotMap.has(normalizedKey)) {
                                snapshotMap.set(normalizedKey, {
                                    modelName: safeName,
                                    chipset: String(chipset).trim(),
                                    availableStock: 0,
                                    totalStock: 0,
                                    incomingQty: 0,
                                    incomingAmount: 0,
                                    distributor: "Intech"
                                });
                            }
                            const entry = snapshotMap.get(normalizedKey)!;
                            entry.availableStock += available;
                            entry.totalStock += total;
                            if (entry.chipset === "Unknown" && chipset !== "Unknown") entry.chipset = chipset;
                        });
                    }

                    const backlogSheetName = sheetNames.find(name => normalize(name).includes("backlog"));
                    if (backlogSheetName) {
                        const sheet = workbook.Sheets[backlogSheetName];
                        const rows = XLSX.utils.sheet_to_json<any>(sheet);
                        rows.forEach(row => {
                            const modelName = row["Item"];
                            if (!modelName) return;

                            const safeName = String(modelName).trim();
                            const normalizedKey = safeName.replace(/\s+/g, '').toUpperCase();

                            const qty = parseNum(row["수량"]);
                            const amt = parseNum(row["금액"]);

                            if (!snapshotMap.has(normalizedKey)) {
                                snapshotMap.set(normalizedKey, {
                                    modelName: safeName,
                                    chipset: "Unknown",
                                    availableStock: 0,
                                    totalStock: 0,
                                    incomingQty: 0,
                                    incomingAmount: 0,
                                    distributor: "Intech"
                                });
                            }
                            const entry = snapshotMap.get(normalizedKey)!;
                            entry.incomingQty += qty;
                            entry.incomingAmount += amt;
                        });
                    }
                }

                const snapshotData = Array.from(snapshotMap.values());
                const distList = Array.from(distributors);

                // --- Debug Logs ---
                console.log(`[ExcelParser] Weekly Data Count: ${weeklyData.length} rows`);
                const salesData = weeklyData.filter(d => d.type === 'sales');
                console.log(`[ExcelParser] Total Sales Rows: ${salesData.length}`);
                console.log(`[ExcelParser] Total Sales Qty Sum:`, salesData.reduce((acc, cur) => acc + cur.qty, 0));

                console.log(`[ExcelParser] Final Snapshot Count: ${snapshotData.length} lines (RefWeek: ${referenceWeek})`);

                resolve({
                    weeklyData,
                    snapshotData,
                    distributors: distList,
                    referenceWeek
                });

            } catch (error) {
                console.error("[ExcelParser] Critical Error:", error);
                reject(error);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsBinaryString(file);
    });
};
