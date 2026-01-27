"use client";

import { useState, useMemo } from "react";
import { Container, Title, Text, Group, Paper, Tabs, Table, Select, MultiSelect, ScrollArea, SimpleGrid, Pagination, Badge, TextInput, Grid, SegmentedControl, Accordion, Divider, NumberInput, ActionIcon, Collapse, Button, FileButton, LoadingOverlay } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import '@mantine/dates/styles.css'; // [필수] 달력 스타일 깨짐 방지
import 'dayjs/locale/ko';
import { Dropzone } from "@mantine/dropzone";
import { AreaChart } from "@mantine/charts";
import { IconUpload, IconFileSpreadsheet, IconChartBar, IconBuildingWarehouse, IconSearch, IconFilter, IconDownload } from "@tabler/icons-react";
import { parseExcel } from "@/utils/excelParser";
import * as XLSX from "xlsx";
import { WeeklyData, SnapshotData } from "@/types/data";
import { notifications } from "@mantine/notifications";
import { storageService } from "@/services/storageService";
import { useEffect } from "react";

// Custom Tooltip Component
const CustomTooltip = ({ active, payload, label, pLabel, sLabel }: any) => {
    if (active && payload && payload.length) {
        return (
            <Paper withBorder p="xs" shadow="md" style={{ backgroundColor: 'white' }}>
                <Text size="sm" fw={700} mb={5}>{label}</Text>
                {payload.map((entry: any, index: number) => {
                    // Determine Display Name based on DataKey or Series Name
                    // entry.name might be 'Primary'/'Secondary' or 'DistributorName'
                    // If 'Primary', show pLabel. If 'Secondary', show sLabel.
                    // If it's a distributor name (non-comparison mode), show entry.name directly.

                    let displayName = entry.name;
                    if (entry.name === 'Primary' || entry.name === '기준데이터') displayName = pLabel;
                    if (entry.name === 'Secondary' || entry.name === '비교데이터') displayName = sLabel;

                    return (
                        <Group key={index} gap="xs" justify="space-between">
                            <Text size="xs" c={entry.color} style={{ marginRight: 10 }}>
                                {displayName}:
                            </Text>
                            <Text size="xs" fw={500}>
                                {new Intl.NumberFormat().format(entry.value)}
                            </Text>
                        </Group>
                    );
                })}
            </Paper>
        );
    }
    return null;
};

export default function RunRatePage() {
    const [loading, setLoading] = useState(false);


    // Raw Data
    // Raw Data
    const [weeklyData, setWeeklyData] = useState<WeeklyData[]>([]);
    const [snapshotData, setSnapshotData] = useState<SnapshotData[]>([]); // Typed correctly
    const [analysisData, setAnalysisData] = useState<any[]>([]); // New state for persisted analysis
    const [refWeek, setRefWeek] = useState<string | null>(null);

    // [New] Dynamic Settings
    const [targetWeeks, setTargetWeeks] = useState<number>(8);
    const [runRateBasis, setRunRateBasis] = useState<number>(4);

    // Extracted Options for Filters
    const [optYears, setOptYears] = useState<string[]>([]);
    const [optDistributors, setOptDistributors] = useState<string[]>([]);
    const [optChipsets, setOptChipsets] = useState<string[]>([]);
    const [optTypes, setOptTypes] = useState<string[]>([]);
    const [optDealers, setOptDealers] = useState<string[]>([]);
    const [optModels, setOptModels] = useState<string[]>([]);
    const [optProducts, setOptProducts] = useState<string[]>([]);

    // Selected Filters (Primary)
    const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([new Date(2024, 0, 1), new Date()]); // [Start, End]
    const [selDistributors, setSelDistributors] = useState<string[]>([]);
    const [selChipsets, setSelChipsets] = useState<string[]>([]);
    const [selTypes, setSelTypes] = useState<string[]>([]);
    const [selDealers, setSelDealers] = useState<string[]>([]);
    const [selModels, setSelModels] = useState<string[]>([]);
    const [selProducts, setSelProducts] = useState<string[]>([]);

    // Selected Filters (Comparison)
    const [compDistributors, setCompDistributors] = useState<string[]>([]);
    // Removed compChipsets, compModels as per request (Inherit Main Filter)

    // UI State
    const [dashboardTab, setDashboardTab] = useState<string | null>("trend"); // 'trend' | 'analysis'
    const [activeTab, setActiveTab] = useState<string | null>("model"); // Grid Tabs
    const [viewMode, setViewMode] = useState<string>("Month"); // 'Month' | 'Week'
    const [activePage, setActivePage] = useState(1);
    const ROWS_PER_PAGE = 20;

    // 드롭다운 옵션 생성 (Null Safe & Simplified)
    const uniqueOptions = useMemo(() => {
        if (!weeklyData || weeklyData.length === 0) return { dists: [], models: [], chipsets: [], types: [], dealers: [], products: [] };

        const dists = Array.from(new Set(weeklyData.map(d => d.distributor || "Unknown"))).sort();
        const models = Array.from(new Set(weeklyData.map(d => d.modelName || "Unknown"))).sort();
        const chipsets = Array.from(new Set(weeklyData.map(d => d.chipset || "Unknown"))).sort();
        const types = Array.from(new Set(weeklyData.map(d => d.categoryType || "N/A"))).filter(x => x !== "N/A").sort();
        const dealers = Array.from(new Set(weeklyData.map(d => d.dealerName || "N/A"))).filter(x => x !== "N/A").sort();
        const products = Array.from(new Set(weeklyData.map(d => d.product || "Unknown"))).filter(x => x !== "Unknown").sort();

        return { dists, models, chipsets, types, dealers, products };
    }, [weeklyData]);


    // [Helper] 컬럼 찾기 (공백 제거, 대소문자 무시, 키워드 포함 여부 확인)
    const findHeaderKey = (rowKeys: string[], candidates: string[]) => {
        return rowKeys.find(key => {
            const normalizedKey = key.toUpperCase().replace(/\s/g, ''); // 공백제거+대문자
            return candidates.some(candidate => normalizedKey.includes(candidate.toUpperCase()));
        });
    };

    // [Helper] 숫자 정제 (콤마 제거, 공백 제거, 안전한 변환)
    const parseNum = (val: any) => {
        if (typeof val === 'number') return val; // 이미 숫자면 OK
        if (val === undefined || val === null) return 0;

        // 1. 문자로 변환
        let str = String(val).trim();
        if (str === '') return 0;

        // 2. 콤마(,) 제거
        str = str.replace(/,/g, '');

        // 3. 실수(Float)로 변환
        const num = parseFloat(str);

        // 4. NaN 체크
        return isNaN(num) ? 0 : num;
    };

    // [Helper] 주차 정제 (W01 -> 1, 숫자만 추출)
    const parseWeek = (val: any) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const str = String(val);
        // "W" 등 문자가 섞여있으면 숫자만 추출
        const num = parseInt(str.replace(/\D/g, ''), 10);
        return isNaN(num) ? 0 : num;
    };


    // [Helper] 엑셀 날짜 파싱 (Serial Number or String -> Date Object)
    const parseExcelDate = (val: any) => {
        if (!val) return null;

        // 1. 엑셀 날짜 일련번호 (예: 45321) 처리
        if (typeof val === 'number') {
            // 엑셀 기준일(1900-01-01) 보정 (Excel leap year bug included ~ 25569 offset)
            const date = new Date(Math.round((val - 25569) * 86400 * 1000));
            return date;
        }

        // 2. 문자열 날짜 처리
        const date = new Date(val);
        return isNaN(date.getTime()) ? null : date;
    };

    // [Helper] 날짜 -> YYYY-MM-DD 문자열 변환 (Key 생성용)
    const formatDateKey = (date: Date) => {
        return date.toISOString().split('T')[0];
    };

    // [Helper] 날짜 객체 -> "YYYY-MM-DD" 문자열 변환 (한국 시간 기준 안전 변환)
    const toDateString = (dateVal: Date | any) => {
        if (!dateVal || isNaN(new Date(dateVal).getTime())) return null;
        const d = new Date(dateVal);
        // 로컬 시간 기준 연/월/일 추출 (UTC 변환 방지)
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // [Helper] 날짜로 주차 계산 (ISO 8601 기준 아님, 간단하게 연/주차 계산: 1월 1일 기준)
    const getYearWeekFromDate = (date: Date) => {
        const year = date.getFullYear();
        const start = new Date(year, 0, 1);
        const days = Math.floor((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        const week = Math.ceil((days + 1) / 7);
        return { year, week };
    };

    // [Helper] 모델명 정규화 (매칭률 향상)
    const normalizeKey = (str: string | undefined) => {
        if (!str) return "UNKNOWN";
        return String(str).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    };

    // Load Data on Mount
    // Load Data on Mount
    useEffect(() => {
        const init = async () => {
            console.log("🚀 [Init] 데이터 로딩 시작...");
            setLoading(true);

            // [안전장치] 15초 뒤에 강제로 로딩 끄기 (무한 로딩 방지)
            const safetyTimer = setTimeout(() => {
                if (loading) {
                    console.warn("⚠️ [Timeout] 로딩 시간이 초과되었습니다.");
                    setLoading(false);
                    alert("데이터 로딩 시간이 너무 깁니다. 새로고침 하거나 네트워크를 확인해주세요.");
                }
            }, 15000);

            try {
                console.time("LoadData"); // 시간 측정 시작
                const data = await storageService.loadData();
                console.timeEnd("LoadData"); // 시간 측정 종료

                if (data && data.weeklyData) {
                    console.log(`📦 [Data] ${data.weeklyData.length}개 행 로드됨. 날짜 변환 시작...`);

                    // 대용량 데이터 처리 (String -> Date 변환)
                    const hydratedWeekly = data.weeklyData.map((item: any) => ({
                        ...item,
                        date: item.date ? new Date(item.date) : null
                    }));

                    setWeeklyData(hydratedWeekly);
                    setSnapshotData(data.currentSnapshot || []);
                    setAnalysisData(data.analysisResult || []);
                    setRefWeek(data.referenceWeek || "Unknown");
                    console.log("✅ [Success] 데이터 적용 완료");
                } else {
                    console.log("ℹ️ [Info] 저장된 데이터가 없습니다.");
                }
            } catch (err) {
                console.error("❌ [Error] 데이터 로딩 중 오류 발생:", err);
                alert("데이터를 불러오는 중 오류가 발생했습니다.");
            } finally {
                clearTimeout(safetyTimer); // 타이머 해제
                setLoading(false); // 로딩 종료
                console.log("🏁 [Finish] 로딩 상태 해제");
            }
        };
        init();
    }, []);

    const handleFileUpload = async (files: File[]) => {
        if (files.length === 0) return;
        const file = files[0];

        setLoading(true);
        try {
            console.log("🚀 Upload Debugging Started (Multi-sheet Mode)...");
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });

            let parsedWeeklyData: any[] = [];
            let parsedSnapshotData: any[] = []; // Changed to array for granular inventory
            let detectedRefWeek = "Unknown";

            // =========================================================
            // 1. [핵심 변경] 모든 판매 데이터 시트 통합 처리
            // =========================================================
            // 'Sell' 또는 'Sales'가 들어간 모든 시트를 찾음 (배열)
            const salesSheetNames = workbook.SheetNames.filter(name =>
                name.toLowerCase().includes('sell') || name.toLowerCase().includes('sales')
            );

            console.log(`📉 Found Sales Sheets:`, salesSheetNames);

            if (salesSheetNames.length > 0) {
                const aggMap = new Map<string, any>();
                let totalQty = 0;

                // 발견된 모든 시트를 순회하며 데이터 수집
                salesSheetNames.forEach(sheetName => {
                    console.group(`Processing Sheet: ${sheetName}`);
                    const sheet = workbook.Sheets[sheetName];
                    const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

                    if (rawData.length > 0) {
                        const keys = Object.keys(rawData[0]);
                        console.log("📋 Found Headers:", keys);

                        // 1. 헤더 찾기 (엄격 모드: 사용자가 알려준 헤더명 그대로 사용)
                        // 유연한 찾기(findHeaderKey) 대신 정확한 매칭 사용 권장
                        const colInvoiceDate = keys.find(k => k.trim() === 'Invoice Date');
                        const colModel = keys.find(k => k.trim() === '변환 Model Name');
                        const colDist = keys.find(k => k.includes('업체명') || k === 'DISTISUBNAME');
                        const colQty = keys.find(k => k.trim() === 'QTY');
                        const colChipset = keys.find(k => k.trim() === '칩셋' || k === 'Chipset');
                        const colType = keys.find(k => k.trim() === '구분' || k.trim() === 'Type');
                        const colDealer = keys.find(k => k.includes('판매처') || k.includes('Dealer'));
                        const colProduct = keys.find(k => k.trim() === '제품' || k.trim().toUpperCase() === 'PRODUCT'); // [New]

                        if (colInvoiceDate && colModel && colQty) {
                            let sheetQty = 0;
                            rawData.forEach((row: any, index: number) => {
                                // 1. 값 파싱
                                const rawDate = row[colInvoiceDate];
                                const dateVal = parseExcelDate(rawDate);
                                const q = parseNum(row[colQty]);
                                const model = String(row[colModel] || "").trim();
                                const dist = colDist ? String(row[colDist] || "").trim() : "Unknown";
                                const type = colType ? String(row[colType] || "").trim() : "Unknown";
                                const dealer = colDealer ? String(row[colDealer] || "").trim() : "Unknown";
                                const product = colProduct ? String(row[colProduct] || "").trim() : "Unknown"; // [New]

                                // 2. 상태 진단 (왜 누락될 뻔했는지 확인)
                                let status = "정상 (Valid)";
                                // let isError = false; 

                                if (!dateVal) {
                                    status = `날짜 변환 실패 (Raw: ${rawDate})`;
                                    // isError = true;
                                } else if (q === 0) {
                                    status = "수량 0 (Zero Qty)";
                                } else if (!model || model === "UNKNOWN") {
                                    status = "모델명 없음";
                                    // isError = true;
                                }

                                // 3. 키 생성 (중복 병합 방지: 행 번호를 키에 포함)
                                // [중요] index를 넣어서 절대 병합되지 않게 함 -> 186행 그대로 나오게 유도
                                const dateStr = dateVal ? toDateString(dateVal) : "MISSING_DATE";
                                const key = `ROW_${index}_${dateStr}_${normalizeKey(model)}`;

                                // 4. 무조건 저장 (Map에 추가)
                                // No-Filter Mode: We overwrite or add unique keys per row
                                const { year, week } = dateVal ? getYearWeekFromDate(dateVal) : { year: 0, week: 0 };

                                aggMap.set(key, {
                                    id: key,
                                    rowIndex: index + 2, // 엑셀 행 번호 (헤더 제외 2부터 시작)
                                    date: dateStr,
                                    year: year,
                                    week: week,
                                    month: (dateVal && dateStr) ? parseInt(dateStr.split('-')[1]) : 0,
                                    distributor: dist,
                                    modelName: model,
                                    chipset: colChipset ? String(row[colChipset] || "Unknown").trim() : "Unknown",
                                    qty: q,
                                    categoryType: type,
                                    dealerName: dealer,
                                    product: product, // [New]
                                    type: 'sales',
                                    status: status, // [진단용] 상태 메시지 저장
                                    rawDate: rawDate // 원본 날짜 데이터 저장
                                });

                                // Total accumulators might be skewed if we include invalid rows, but ok for debugging
                                if (status === "정상 (Valid)") {
                                    totalQty += q;
                                    sheetQty += q;
                                }
                            });
                            console.log(`-> Added ${sheetQty} units from ${sheetName} (Valid Rows)`);
                        } else {
                            console.warn(`-> Skipped ${sheetName}: Missing Critical Headers (Invoice Date, 변환 Model Name, QTY)`);
                        }
                    }
                    console.groupEnd();
                });

                parsedWeeklyData = Array.from(aggMap.values());
                console.log(`✅ Total Sales Loaded (All Sheets): ${totalQty}`);
            } else {
                console.warn("❌ No Sales sheets found.");
            }

            // =========================================================
            // 2. 재고 데이터 처리 (기존 유지 + parseWeek 적용)
            // =========================================================
            const invSheetName = workbook.SheetNames.find(name =>
                name.toLowerCase().includes('inventory') && !name.toLowerCase().includes('sell')
            );

            if (invSheetName) {
                console.log(`📦 Processing Inventory: ${invSheetName}`);
                const sheet = workbook.Sheets[invSheetName];
                const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

                if (rawData.length > 0) {
                    const keys = Object.keys(rawData[0]);

                    // 재고 시트도 동일한 헤더 규칙 적용
                    const colYear = findHeaderKey(keys, ['YEAR']);
                    const colWeek = findHeaderKey(keys, ['주차', 'WEEK']);
                    const colModel = findHeaderKey(keys, ['모델명', '변환 Model Name', '변환ModelName']);
                    const colQty = findHeaderKey(keys, ['수량', 'QTY']);
                    const colDist = findHeaderKey(keys, ['업체명', 'DISTISUBNAME']); // [New] Distributor in Inventory

                    if (colYear && colWeek && colModel && colQty) {
                        // [Step 1] 최신 주차 찾기 (W01 등 처리 포함)
                        let maxYear = 0, maxWeek = 0;

                        rawData.forEach(row => {
                            const y = parseNum(row[colYear]);
                            const w = parseWeek(row[colWeek]);
                            if (y > maxYear) { maxYear = y; maxWeek = w; }
                            else if (y === maxYear && w > maxWeek) { maxWeek = w; }
                        });

                        if (maxYear > 0) {
                            detectedRefWeek = `${maxYear}-W${String(maxWeek).padStart(2, '0')}`;
                            console.log(`📅 Latest Inventory Date: ${detectedRefWeek}`);

                            // [Step 2] 합산
                            let totalStock = 0;
                            rawData.forEach(row => {
                                const y = parseNum(row[colYear]);
                                const w = parseWeek(row[colWeek]);

                                if (y === maxYear && w === maxWeek) {
                                    const modelName = row[colModel];
                                    const q = parseNum(row[colQty]);
                                    const dist = colDist ? String(row[colDist] || "Unknown").trim() : "Unknown"; // [New]

                                    if (modelName) {
                                        const normKey = normalizeKey(modelName);
                                        // Store individual records instead of pre-aggregating
                                        parsedSnapshotData.push({
                                            modelName: modelName,
                                            distributor: dist, // [New]
                                            totalStock: q,
                                            availableStock: q,
                                            incomingQty: 0,
                                            incomingAmount: 0,
                                            chipset: "Unknown" // Can populate if needed
                                        });

                                        totalStock += q;
                                    }
                                }
                            });
                            console.log(`✅ Inventory Loaded. Total Stock: ${totalStock}`);
                        }
                    } else {
                        console.error("❌ Inventory Header Mismatch. Keys:", keys);
                    }
                }
            }

            // =========================================================
            // 3. [New] Backlog 데이터 처리 (PO / OTW)
            // =========================================================
            const backlogSheetName = workbook.SheetNames.find(name =>
                name.toUpperCase().includes('BACKLOG')
            );

            const backlogMap = new Map<string, { po: number, otw: number }>();

            if (backlogSheetName) {
                console.log(`📦 Processing Backlog: ${backlogSheetName}`);
                const sheet = workbook.Sheets[backlogSheetName];
                const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

                if (rawData.length > 0) {
                    // [Refinement] Robust Key Detection (Handle "수량 " vs "수량")
                    const keys = Object.keys(rawData[0]);

                    const keyStatus = keys.find(k => k.trim() === '상태') || '상태';
                    const keyModel = keys.find(k => k.trim() === 'Model Name') || 'Model Name';
                    const keyQty = keys.find(k => k.trim() === '수량' || k.trim().toUpperCase() === 'QTY') || '수량';

                    console.log(`🔑 Backlog Keys Detected: Status=[${keyStatus}], Model=[${keyModel}], Qty=[${keyQty}]`);

                    let poTotal = 0;
                    let otwTotal = 0;
                    let lastModelName = ""; // [Fix] Handle merged cells (fill-down)

                    rawData.forEach((row: any) => {
                        // Strict Key Access using detected keys
                        let status = String(row[keyStatus] || "").trim().toUpperCase(); // [Fix] Case insensitive

                        // Model Name: Remove _A
                        let modelName = String(row[keyModel] || "").trim();

                        // [Fix] Merged Cells Handling: If modelName is empty, try to use lastModelName
                        // Condition: We assume rows are grouped. If we encounter a new valid modelName, update lastModelName.
                        if (modelName) {
                            lastModelName = modelName;
                        } else if (lastModelName) {
                            // Only inherit if it looks like a continuation (e.g., has Qty/Status)
                            modelName = lastModelName;
                        }

                        // Qty: 'Qty' or '수량'
                        const qty = parseNum(row[keyQty]);

                        if (!modelName || qty <= 0) return;

                        // 뒷부분 _A 제거 (모델명 통합)
                        // Note: normalizeKey removes _ anyway, but explicit replace is safer for logic intent
                        modelName = modelName.replace(/_A$/, '');
                        const normKey = normalizeKey(modelName);

                        if (!backlogMap.has(normKey)) {
                            backlogMap.set(normKey, { po: 0, otw: 0 });
                        }
                        const entry = backlogMap.get(normKey)!;

                        if (status === 'PO') {
                            entry.po += qty;
                            poTotal += qty;
                        } else if (['선적', '통관', '수입신고'].includes(status)) {
                            entry.otw += qty;
                            otwTotal += qty;
                        }
                    });
                    console.log(`✅ Backlog Loaded. PO: ${poTotal}, OTW: ${otwTotal}`);
                }

                // [Merge] Backlog Data into Snapshot Data
                // 1. Update existing items in snapshot
                parsedSnapshotData.forEach(item => {
                    const normKey = normalizeKey(item.modelName);
                    if (backlogMap.has(normKey)) {
                        const back = backlogMap.get(normKey)!;
                        item.poQty = back.po;
                        item.otwQty = back.otw;
                        backlogMap.delete(normKey); // Processed
                    } else {
                        item.poQty = 0;
                        item.otwQty = 0;
                    }
                });

                // 2. Add remaining backlog items (not in inventory)
                backlogMap.forEach((val, normKey) => {
                    // We need to recover original name? 
                    // Since Map key is normalized, we might lose casing. 
                    // But simplified: use normKey or try to find a way. 
                    // For now, we utilize the key as model name or 'Unknown'
                    // Actually, let's store the original name in the map if possible.
                    // Re-implementation of Loop above to store name? 
                    // Simplified: Just use the key for now.
                    parsedSnapshotData.push({
                        modelName: normKey, // Fallback (Ideally store real name)
                        distributor: "Unknown",
                        totalStock: 0,
                        availableStock: 0,
                        incomingQty: 0,
                        incomingAmount: 0,
                        chipset: "Unknown",
                        poQty: val.po,
                        otwQty: val.otw
                    });
                });

                // 저장 및 화면 갱신
                // 저장 및 화면 갱신
                // [Changed] We no longer pre-calculate analysis data to allow dynamic calculation on the fly.
                await storageService.saveData(parsedWeeklyData, parsedSnapshotData, [], detectedRefWeek);

                setWeeklyData(parsedWeeklyData);
                setSnapshotData(parsedSnapshotData); // Now array
                setAnalysisData([]); // Clear persisted analysis
                setRefWeek(detectedRefWeek);

                notifications.show({
                    title: "완료",
                    message: "데이터 로드 완료 (Multi-sheet)",
                    color: "blue"
                });

            }
        } catch (error) {
            console.error("Upload Error:", error);
            alert("데이터 처리 중 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    // [New] 현재 조회 데이터 다운로드 (필터 적용됨) - Removed
    // const handleExportFilteredData = ... (Removed)

    // --- Data Logic: Filtering & Aggregation ---

    // 4. Comparison Logic Check
    const isComparisonActive = compDistributors.length > 0;

    // Dynamic Tooltip Labels
    const primaryLabel = selDistributors.length > 0 ? selDistributors.join(', ') : '기준 데이터(전체)';
    const secondaryLabel = compDistributors.length > 0 ? compDistributors.join(', ') : '비교 데이터';

    // 1. Filtering Logic (Primary)
    const filteredWeekly = useMemo(() => {
        if (!weeklyData) return [];

        const [start, end] = dateRange;

        return weeklyData.filter((item) => {
            // 1. Date Filter (String Comparison)
            const startStr = start ? toDateString(start) : null;
            const endStr = end ? toDateString(end) : null;
            let isDateMatch = true;

            if (startStr && endStr && item.date) {
                const itemDateStr = (item.date as any) instanceof Date ? toDateString(item.date) : String(item.date);
                if (itemDateStr && itemDateStr !== 'null' && itemDateStr !== 'MISSING_DATE') {
                    isDateMatch = itemDateStr >= startStr && itemDateStr <= endStr;
                } else {
                    isDateMatch = false;
                }
            }

            // 2. Dropdown Filters
            const distMatch = selDistributors.length === 0 || selDistributors.includes(item.distributor);
            const modelMatch = selModels.length === 0 || selModels.includes(item.modelName);
            const chipsetMatch = selChipsets.length === 0 || selChipsets.includes(item.chipset);

            // Other Filters (Strict)
            const typeMatch = selTypes.length === 0 || selTypes.includes(item.categoryType || "Unknown");
            const dealerMatch = selDealers.length === 0 || selDealers.includes(item.dealerName || "Unknown");
            const productMatch = selProducts.length === 0 || selProducts.includes(item.product || "Unknown");

            return isDateMatch && distMatch && modelMatch && chipsetMatch && typeMatch && dealerMatch && productMatch;
        });
    }, [
        weeklyData,
        dateRange,
        selDistributors,
        selModels,
        selChipsets,
        selTypes,
        selDealers,
        selProducts
    ]);

    // 2. Comparison Data Filtering (Inherits Main Filters, Overrides Distributor)
    const compFilteredWeekly = useMemo(() => {
        // 비교 총판이 선택되지 않았으면 계산하지 않음 (빈 배열 반환)
        if (compDistributors.length === 0) return [];

        return weeklyData.filter((item) => {
            // [Override] Distributor: 비교용 총판 State 사용
            const distMatch = compDistributors.includes(item.distributor);

            // [Inherit] Date Range (String Comparison)
            const [start, end] = dateRange;
            const startStr = start ? toDateString(start) : null;
            const endStr = end ? toDateString(end) : null;
            let matchDate = true;

            if (startStr && endStr && item.date) {
                matchDate = item.date >= startStr && item.date <= endStr;
            }

            // Chipset (메인 필터 상속)
            const chipsetMatch = selChipsets.length === 0 || selChipsets.includes(item.chipset);

            // Type (메인 필터 상속)
            const typeMatch = selTypes.length === 0 || selTypes.includes(item.categoryType || "Unknown");

            // Dealer (메인 필터 상속)
            const dealerMatch = selDealers.length === 0 || selDealers.includes(item.dealerName || "Unknown");

            // Product (메인 필터 상속)
            const productMatch = selProducts.length === 0 || selProducts.includes(item.product || "Unknown");

            // Model (메인 필터 상속)
            const modelMatch = selModels.length === 0 || selModels.includes(item.modelName);

            return distMatch && matchDate && chipsetMatch && typeMatch && dealerMatch && productMatch && modelMatch;
        });
    }, [
        weeklyData,
        compDistributors, // 오직 이것만 비교용 State
        dateRange,
        selChipsets,      // 나머지는 다 메인 State 의존
        selTypes,
        selDealers,
        selProducts,
        selModels,
    ]);

    // 2. Trend Aggregation (Dynamic: Month or Week)
    const trendChartData = useMemo(() => {
        const acc: Record<string, any> = {};

        // Helper to generate time keys based on dateRange
        if (!dateRange[0] || !dateRange[1]) return [];

        let current = new Date(dateRange[0]);
        current.setDate(1); // Start from 1st of month
        const end = new Date(dateRange[1]);

        while (current <= end) {
            if (viewMode === 'Month') {
                const y = current.getFullYear();
                const m = current.getMonth() + 1;
                const yearShort = String(y).slice(2);
                const mStr = String(m).padStart(2, '0');
                const key = `${yearShort}.${mStr}`;
                acc[key] = {
                    timeKey: key,
                    '기준데이터': 0,
                    '비교데이터': 0,
                    'Total': 0, // [Changed] '전체' -> 'Total' for consistency
                    sortKey: y * 100 + m
                };
                current.setMonth(current.getMonth() + 1);
            } else {
                break;
            }
        }

        // Single Pass Loop for efficiency
        weeklyData.forEach(d => {
            if (d.type !== 'sales') return;

            // 1. Check Shared Filters (Model, Chipset, Products, Type, Dealer)
            const modelMatch = selModels.length === 0 || selModels.includes(d.modelName);
            const chipsetMatch = selChipsets.length === 0 || selChipsets.includes(d.chipset);
            const typeMatch = selTypes.length === 0 || selTypes.includes(d.categoryType || "N/A"); // [New]
            const dealerMatch = selDealers.length === 0 || selDealers.includes(d.dealerName || "N/A"); // [New]
            const productMatch = selProducts.length === 0 || selProducts.includes(d.product || "Unknown");

            if (!(modelMatch && chipsetMatch && typeMatch && dealerMatch && productMatch)) return;

            // 2. Determine Time Key
            let timeKey = "";
            let sortKey = 0;
            if (viewMode === 'Month') {
                let m = d.month || 0;
                if (m === 0 && d.week > 0) m = Math.ceil(d.week / 4.35);
                if (m < 1) m = 1; if (m > 12) m = 12;
                const yearShort = String(d.year).slice(2);
                const mStr = String(m).padStart(2, '0');
                timeKey = `${yearShort}.${mStr}`;
                sortKey = d.year * 100 + m;
            } else {
                let w = d.week || 0;
                if (w < 1) w = 1;
                const yearShort = String(d.year).slice(2);
                const wStr = String(w).padStart(2, '0');
                timeKey = `${yearShort}.W${wStr}`;
            }

            // Check Date Range (Strict String Comparison)
            const dStr = (d.date as any) instanceof Date ? toDateString(d.date) : String(d.date);
            const startStr = dateRange[0] ? toDateString(dateRange[0]) : "";
            const endStr = dateRange[1] ? toDateString(dateRange[1]) : "";
            if (dStr && dStr !== 'null' && dStr !== 'MISSING_DATE' && startStr && endStr) {
                if (dStr < startStr || dStr > endStr) return;
            } else if (startStr && endStr) {
                // 날짜가 없는데 기간 필터가 걸려 있으면 제외
                return;
            }

            if (!acc[timeKey]) return; // Skip if out of range bucket

            // 3. Add to 'Total' - Always added if shared filters match
            acc[timeKey]['Total'] += d.qty; // [Changed] '전체' -> 'Total'

            // 4. Add to '기준데이터' (Primary) - If Distributor matches
            if (selDistributors.length === 0 || selDistributors.includes(d.distributor)) {
                acc[timeKey]['기준데이터'] += d.qty;
            }

            // 5. Add to '비교데이터' (Secondary) - If Comparison Distributor matches
            if (compDistributors.length > 0 && compDistributors.includes(d.distributor)) {
                acc[timeKey]['비교데이터'] += d.qty;
            }
        });

        return Object.values(acc).sort((a: any, b: any) => a.sortKey - b.sortKey);
    }, [
        weeklyData, dateRange, viewMode,
        selDistributors, compDistributors,
        selModels, selChipsets, selProducts, selTypes, selDealers
    ]);

    // 3. Calculate Totals for Summary Table
    const chartTotals = useMemo(() => {
        return trendChartData.reduce((acc: any, curr: any) => ({
            primary: acc.primary + (curr['기준데이터'] || 0),
            secondary: acc.secondary + (curr['비교데이터'] || 0)
        }), { primary: 0, secondary: 0 });
    }, [trendChartData]);

    // 4. Tabular Data Aggregation
    const tableData = useMemo(() => {
        // We need to aggregate filteredWeekly by the Active Tab Key
        // Tab keys: 'model' | 'distributor' | 'dealer'
        const map = new Map<string, {
            key: string;
            sales: number;
            chipset?: string; // Only meaningful for Model view
            dealer?: string; // Only meaningful for Dealer view
        }>();

        filteredWeekly.forEach(d => {
            let groupKey = "";
            let chipsetStr = "";

            if (activeTab === 'model') {
                groupKey = d.modelName;
                chipsetStr = d.chipset;
            } else if (activeTab === 'distributor') {
                groupKey = d.distributor;
            } else if (activeTab === 'dealer') {
                groupKey = d.dealerName || "Unknown";
            } else {
                groupKey = "Total";
            }

            if (!map.has(groupKey)) {
                map.set(groupKey, { key: groupKey, sales: 0, chipset: chipsetStr });
            }

            if (d.type === 'sales') {
                map.get(groupKey)!.sales += d.qty;
            }
        });

        return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
    }, [filteredWeekly, activeTab]);

    // 4. Inventory Analysis Logic (Dynamic Calculation - Date-based)
    const analysisDataComputed = useMemo(() => {
        // [Changed] Date-based run-rate calculation
        // 1. Find latest date from raw sales data
        // 2. Calculate year/week for that date
        // 3. Generate N weeks list going backwards
        // 4. Calculate first day of oldest week
        // 5. Filter sales by date range (first day ~ latest date)

        if (weeklyData.length === 0) return { list: [], refWeek: 'N/A' };

        // === Step 1: Find Latest Date from Sales Data ===
        const salesData = weeklyData.filter(d => d.type === 'sales' || d.sell_out !== undefined);
        if (salesData.length === 0) return { list: [], refWeek: 'N/A' };

        // Parse all dates and find max
        const validDates = salesData
            .map(d => {
                if (!d.date) return null;
                const parsed = (Object.prototype.toString.call(d.date) === '[object Date]') ? (d.date as unknown as Date) : new Date(d.date as string);
                return isNaN(parsed.getTime()) ? null : parsed;
            })
            .filter((d): d is Date => d !== null);

        if (validDates.length === 0) return { list: [], refWeek: 'N/A' };

        const latestDate = new Date(Math.max(...validDates.map(d => d.getTime())));
        console.log(`📅 [Run-rate] Latest Date: ${latestDate.toISOString().slice(0, 10)}`);

        // === Step 2: Calculate Year/Week for Latest Date (ISO 8601) ===
        const getISOWeek = (date: Date): { year: number; week: number } => {
            const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            const dayNum = d.getUTCDay() || 7; // Sunday = 7
            d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of the week
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
            return { year: d.getUTCFullYear(), week: weekNo };
        };

        const latestWeekInfo = getISOWeek(latestDate);
        const refWeekStr = `${latestWeekInfo.year}년 ${latestWeekInfo.week}주차`;
        console.log(`📅 [Run-rate] Latest Week: ${refWeekStr}`);

        // === Step 3: Generate N Weeks List Going Backwards ===
        const getWeekList = (startYear: number, startWeek: number, count: number): { year: number; week: number }[] => {
            const weeks: { year: number; week: number }[] = [];

            // Start from the Monday of the given week
            const getMonday = (year: number, week: number): Date => {
                const jan4 = new Date(year, 0, 4);
                const dayOfWeek = jan4.getDay() || 7;
                const monday = new Date(jan4);
                monday.setDate(jan4.getDate() - (dayOfWeek - 1) + (week - 1) * 7);
                return monday;
            };

            let currentMonday = getMonday(startYear, startWeek);

            for (let i = 0; i < count; i++) {
                const weekInfo = getISOWeek(currentMonday);
                weeks.push({ year: weekInfo.year, week: weekInfo.week });
                // Move to previous week (subtract 7 days)
                currentMonday.setDate(currentMonday.getDate() - 7);
            }
            return weeks;
        };

        const weekList = getWeekList(latestWeekInfo.year, latestWeekInfo.week, runRateBasis);
        console.log(`📅 [Run-rate] Week List (${runRateBasis}주):`, weekList.map(w => `${w.year} W${String(w.week).padStart(2, '0')}`).join(', '));

        // === Step 4: Calculate First Day of Oldest Week (Monday) ===
        const getFirstDayOfWeek = (year: number, week: number): Date => {
            // ISO 8601: Week 1 contains the first Thursday of the year
            const jan4 = new Date(year, 0, 4); // Jan 4 is always in week 1
            const dayOfWeek = jan4.getDay() || 7; // Sunday = 7
            const monday = new Date(jan4);
            monday.setDate(jan4.getDate() - (dayOfWeek - 1)); // Go to Monday of week 1
            monday.setDate(monday.getDate() + (week - 1) * 7); // Add weeks
            return monday;
        };

        const oldestWeek = weekList[weekList.length - 1];
        const startDate = getFirstDayOfWeek(oldestWeek.year, oldestWeek.week);
        const endDate = latestDate;

        const startDateStr = toDateString(startDate);
        const endDateStr = toDateString(endDate);
        console.log(`📅 [Run-rate] Date Range: ${startDateStr} ~ ${endDateStr}`);

        // === Step 5: Filter Sales by Date Range ===
        const recentSales = weeklyData.filter(d => {
            const isSales = d.type === 'sales' || d.sell_out !== undefined;
            if (!isSales) return false;

            // Date filter
            const itemDateStr = (Object.prototype.toString.call(d.date) === '[object Date]') ? toDateString(d.date as unknown as Date) : String(d.date);
            if (!itemDateStr || itemDateStr === 'null' || itemDateStr === 'MISSING_DATE') return false;

            const isInRange = startDateStr && endDateStr && itemDateStr >= startDateStr && itemDateStr <= endDateStr;
            if (!isInRange) return false;

            // Apply all global filters to the run-rate calculation
            const distMatch = selDistributors.length === 0 || selDistributors.includes(d.distributor);
            const modelMatch = selModels.length === 0 || selModels.includes(d.modelName);
            const chipsetMatch = selChipsets.length === 0 || selChipsets.includes(d.chipset);
            const typeMatch = selTypes.length === 0 || selTypes.includes(d.categoryType || "Unknown");
            const dealerMatch = selDealers.length === 0 || selDealers.includes(d.dealerName || "Unknown");
            const productMatch = selProducts.length === 0 || selProducts.includes(d.product || "Unknown");

            return distMatch && modelMatch && chipsetMatch && typeMatch && dealerMatch && productMatch;
        });

        console.log(`📅 [Run-rate] Filtered Sales Count: ${recentSales.length}`);

        // Key: `${distributor}_${modelName}`
        const salesMap = new Map<string, number>();

        recentSales.forEach(d => {
            const key = `${d.distributor}_${d.modelName}`;
            // Handle both qty (standard) or sell_out (if mapped)
            salesMap.set(key, (salesMap.get(key) || 0) + (d.qty || d.sell_out || 0));
        });

        // 4. Merge Snapshot with Sales Data
        const uniqueKeys = new Set<string>();

        // Add keys from Snapshot
        snapshotData.forEach(s => {
            const dist = s.distributor || "Intech"; // Default to Intech if missing
            uniqueKeys.add(`${dist}_${s.modelName}`);
        });

        // Add keys from Sales
        recentSales.forEach(d => {
            uniqueKeys.add(`${d.distributor}_${d.modelName}`);
        });

        const granularResult = Array.from(uniqueKeys).map(key => {
            const [dist, model] = key.split('_');

            // Find matching snapshot item
            const snap = snapshotData.find(s => (s.distributor || "Intech") === dist && s.modelName === model);

            // Get Sales (Total N weeks)
            const totalSalesNW = salesMap.get(key) || 0;
            const runRate = totalSalesNW / runRateBasis; // [Changed] Dynamic divisor

            // Get Stock & Backlog (From Snapshot)
            const stock = snap ? (snap.availableStock || snap.totalStock || 0) : 0;
            const po = snap ? (snap.poQty || 0) : 0;
            const otw = snap ? (snap.otwQty || 0) : 0;

            // [Optimized] Pre-find metadata from full history to avoid multiple find calls
            const historyItem = weeklyData.find(d => d.modelName === model && d.chipset && d.chipset !== "Unknown");
            const finalChipset = snap && snap.chipset !== "Unknown" ? snap.chipset : (historyItem?.chipset || "Unknown");
            const finalProduct = snap && snap.product && snap.product !== "Unknown" ? snap.product : (historyItem?.product || "Unknown");

            return {
                distributor: dist,
                modelName: model,
                chipset: finalChipset,
                runRate: runRate,
                stock: stock,
                po: po,
                otw: otw,
                product: finalProduct,
                // These are needed for filtering the aggregated list
                categoryType: historyItem?.categoryType || "Unknown",
                dealerName: historyItem?.dealerName || "Unknown"
            };
        });

        // Format date range for display (YY.MM.DD ~ YY.MM.DD)
        const formatShortDate = (dateStr: string | null): string => {
            if (!dateStr) return 'N/A';
            const parts = dateStr.split('-');
            if (parts.length !== 3) return dateStr;
            return `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`;
        };
        const dateRangeStr = `${formatShortDate(startDateStr)} ~ ${formatShortDate(endDateStr)}`;

        return { list: granularResult, refWeek: refWeekStr, rawSales: recentSales, dateRangeStr };
    }, [weeklyData, snapshotData, runRateBasis, selDistributors, selModels, selChipsets, selTypes, selDealers, selProducts]);


    // 5. Filtered Analysis Table (Aggregated by Model based on Filters)
    const filteredAnalysisTable = useMemo(() => {
        if (!analysisDataComputed.list || analysisDataComputed.list.length === 0) return [];

        // 1. Filter Logic
        const filtered = analysisDataComputed.list.filter((item: any) => {
            // Apply all global filters to the aggregated list as well
            const distMatch = selDistributors.length === 0 || selDistributors.includes(item.distributor);
            const modelMatch = selModels.length === 0 || selModels.includes(item.modelName);
            const chipsetMatch = selChipsets.length === 0 || selChipsets.includes(item.chipset);
            const productMatch = selProducts.length === 0 || selProducts.includes(item.product || "Unknown");
            const typeMatch = selTypes.length === 0 || selTypes.includes(item.categoryType || "Unknown");
            const dealerMatch = selDealers.length === 0 || selDealers.includes(item.dealerName || "Unknown");

            return distMatch && modelMatch && chipsetMatch && productMatch && typeMatch && dealerMatch;
        });

        // 2. Aggregate by Model
        const grouped = filtered.reduce((acc: any, curr: any) => {
            const key = curr.modelName;
            if (!acc[key]) {
                acc[key] = {
                    modelName: curr.modelName,
                    chipset: curr.chipset,
                    runRate: 0,
                    stock: 0,
                    po: 0,
                    otw: 0
                };
            }
            acc[key].runRate += curr.runRate;
            acc[key].stock += curr.stock;
            acc[key].po += curr.po;
            acc[key].otw += curr.otw;

            // Capture Product info from one of the items
            if (!acc[key].product && curr.product) acc[key].product = curr.product;
            return acc;
        }, {});

        // 3. Calculate WOS & Suggestion
        return Object.values(grouped).map((item: any) => {
            const totalAvailable = item.stock + item.po + item.otw;
            const wos = item.runRate > 0 ? (totalAvailable / item.runRate) : (totalAvailable > 0 ? 999 : 0);

            let suggestion = (item.runRate * targetWeeks) - totalAvailable;
            if (suggestion < 0) suggestion = 0;

            return {
                ...item,
                wos,
                suggestion: Math.ceil(suggestion)
            };
        }).filter((r: any) => r.stock > 0 || r.runRate > 0 || r.po > 0 || r.otw > 0)
            .sort((a: any, b: any) => b.runRate - a.runRate);

    }, [analysisDataComputed, selDistributors, selModels, selChipsets, selProducts, selTypes, selDealers, targetWeeks]);

    // 4. KPI Calculations (Simplified)
    const totalSelectedSales = tableData.reduce((acc, curr) => acc + curr.sales, 0);

    return (
        <Container fluid pos="relative">
            <LoadingOverlay visible={loading} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
            <Group justify="space-between" mb="lg">
                <Title order={2}>All-in-One Sales Analysis</Title>
                <Group>
                    <FileButton onChange={handleFileUpload} accept=".xlsx,.xls" multiple>
                        {(props) => (
                            <Button {...props} size="xs" variant="outline" leftSection={<IconUpload size={14} />}>
                                데이터 업로드 (Excel)
                            </Button>
                        )}
                    </FileButton>
                    <Badge size="lg" color="blue">{totalSelectedSales.toLocaleString()} Units Sold</Badge>
                </Group>
            </Group>

            {/* Dropzone Area */}
            {
                weeklyData.length === 0 && (
                    <Paper withBorder p="xl" radius="md" mb="xl" mt="xl">
                        <Dropzone
                            onDrop={handleFileUpload}
                            loading={loading}
                            onReject={() => alert("파일이 거부되었습니다.")}
                            maxSize={50 * 1024 ** 2}
                        >
                            <Group justify="center" gap="xl" mih={200} style={{ pointerEvents: 'none' }}>
                                <Dropzone.Accept>
                                    <IconUpload size={52} color="var(--mantine-color-blue-6)" stroke={1.5} />
                                </Dropzone.Accept>
                                <Dropzone.Idle>
                                    <IconFileSpreadsheet size={52} color="var(--mantine-color-dimmed)" stroke={1.5} />
                                </Dropzone.Idle>
                                <div>
                                    <Text size="xl" inline ta="center">엑셀 파일을 이곳에 드래그하세요</Text>
                                    <Text size="sm" c="dimmed" ta="center" mt="xs">
                                        통합 판매/재고 데이터를 자동으로 분석합니다.
                                    </Text>
                                </div>
                            </Group>
                        </Dropzone>
                    </Paper>
                )
            }

            {
                weeklyData.length > 0 && (
                    <>
                        {/* Filter Bar (Grid Layout) */}
                        <Group justify="space-between" align="center" mb="sm">
                            <Title order={5}>🔍 데이터 필터링</Title>
                            <Button
                                variant="subtle"
                                color="gray"
                                size="xs"
                                onClick={() => {
                                    setSelDistributors([]);
                                    setSelModels([]);
                                    setSelChipsets([]);
                                    setSelTypes([]);
                                    setSelDealers([]);
                                    setSelProducts([]);
                                    setDateRange([new Date(2024, 0, 1), new Date()]);
                                }}
                            >
                                필터 초기화
                            </Button>
                        </Group>
                        <Paper withBorder p="md" radius="md" mb="lg" bg="gray.0">
                            <Group mb="xs" align="flex-end">
                                {/* 날짜 선택기 (스타일 복구) */}
                                <DatePickerInput
                                    type="range"
                                    label="기간 선택 (Invoice Date)"
                                    placeholder="시작일 - 종료일"
                                    value={dateRange}
                                    onChange={setDateRange as any}
                                    clearable
                                    w={250}
                                />

                                {/* 총판 필터 */}
                                <MultiSelect
                                    label="총판 (Distributor)"
                                    placeholder="전체"
                                    data={uniqueOptions.dists}
                                    value={selDistributors}
                                    onChange={setSelDistributors}
                                    searchable
                                    clearable
                                    nothingFoundMessage="목록 없음"
                                    maxDropdownHeight={200}
                                    styles={{ dropdown: { zIndex: 9999 } }}
                                    w={200}
                                />

                                {/* Type Filter */}
                                <MultiSelect
                                    label="구분 (Type)"
                                    placeholder="B2B/B2C 등"
                                    data={uniqueOptions.types}
                                    value={selTypes}
                                    onChange={setSelTypes}
                                    searchable clearable
                                    w={150}
                                />

                                {/* Chipset Filter */}
                                <MultiSelect
                                    label="칩셋 (Chipset)"
                                    placeholder="칩셋 선택"
                                    data={uniqueOptions.chipsets}
                                    value={selChipsets}
                                    onChange={setSelChipsets}
                                    searchable clearable
                                    w={150}
                                />

                                {/* [New] Product Filter */}
                                <MultiSelect
                                    label="제품군 (Product)"
                                    placeholder="제품군 선택"
                                    data={uniqueOptions.products}
                                    value={selProducts}
                                    onChange={setSelProducts}
                                    searchable clearable
                                    w={150}
                                />

                                {/* Dealer Filter */}
                                <MultiSelect
                                    label="판매처 (Dealer)"
                                    placeholder="판매처 검색"
                                    data={uniqueOptions.dealers}
                                    value={selDealers}
                                    onChange={setSelDealers}
                                    searchable clearable
                                    limit={50}
                                    w={200}
                                />

                                {/* 모델 필터 */}
                                <MultiSelect
                                    label="모델 (Model)"
                                    placeholder="모델 검색"
                                    data={uniqueOptions.models}
                                    value={selModels}
                                    onChange={setSelModels}
                                    searchable
                                    clearable
                                    limit={50}
                                    w={300}
                                />
                            </Group>
                            <SegmentedControl
                                value={viewMode}
                                onChange={setViewMode}
                                data={['Month', 'Week']}
                                size="xs"
                            />

                            {/* Comparison Filters */}
                            <Accordion variant="contained" radius="md" mt="md">
                                <Accordion.Item value="comparison">
                                    <Accordion.Control icon={<IconFilter size={16} color="var(--mantine-color-orange-6)" />}>
                                        <Text c="dimmed" size="sm">판매데이터 비교(옵션)</Text>
                                    </Accordion.Control>
                                    <Accordion.Panel>
                                        <Text size="sm" c="dimmed" mb="xs">
                                            * 비교 대상 총판을 선택하세요. (그 외 조건은 위 필터와 동일하게 적용됩니다)
                                        </Text>
                                        <MultiSelect
                                            label="비교할 총판 선택" placeholder="총판 선택"
                                            data={uniqueOptions.dists} value={compDistributors} onChange={setCompDistributors}
                                            searchable clearable
                                            nothingFoundMessage="결과가 없습니다"
                                            maxDropdownHeight={300}
                                        />
                                    </Accordion.Panel>
                                </Accordion.Item>
                            </Accordion>
                        </Paper>

                        {/* Main Tabs: Trend vs Analysis */}
                        <Tabs value={dashboardTab} onChange={setDashboardTab} variant="outline" radius="md" mb="lg">
                            <Tabs.List>
                                <Tabs.Tab value="trend" leftSection={<IconChartBar size={16} />}>판매 추세 분석</Tabs.Tab>
                                <Tabs.Tab value="analysis" leftSection={<IconBuildingWarehouse size={16} />}>재고 분석 및 오더 제안</Tabs.Tab>
                                <Tabs.Tab value="raw" leftSection={<IconSearch size={16} />}>Raw Data 조회</Tabs.Tab>
                            </Tabs.List>

                            <Tabs.Panel value="trend" pt="md">
                                {/* Main Chart: Monthly/Weekly Trend */}
                                <Paper withBorder p="md" radius="md" mb="lg">
                                    <Group justify="space-between" mb="md">
                                        <Title order={5}>{viewMode}ly Sales Trend</Title>
                                    </Group>

                                    {/* Summary Table */}
                                    <Table withTableBorder withColumnBorders mb="md">
                                        <Table.Thead bg="gray.1">
                                            <Table.Tr>
                                                <Table.Th w={120}>구분</Table.Th>
                                                <Table.Th>대상</Table.Th>
                                                <Table.Th w={150} style={{ textAlign: 'right' }}>총 판매량</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            <Table.Tr>
                                                <Table.Td fw={700} c="blue.6">기준데이터</Table.Td>
                                                <Table.Td>{primaryLabel}</Table.Td>
                                                <Table.Td fw={700} style={{ textAlign: 'right' }}>
                                                    {new Intl.NumberFormat().format(chartTotals.primary)}
                                                </Table.Td>
                                            </Table.Tr>
                                            {isComparisonActive && (
                                                <Table.Tr>
                                                    <Table.Td fw={700} c="orange.6">비교데이터</Table.Td>
                                                    <Table.Td>{secondaryLabel}</Table.Td>
                                                    <Table.Td fw={700} style={{ textAlign: 'right' }}>
                                                        {new Intl.NumberFormat().format(chartTotals.secondary)}
                                                    </Table.Td>
                                                </Table.Tr>
                                            )}
                                        </Table.Tbody>
                                    </Table>

                                    <AreaChart
                                        h={350}
                                        data={trendChartData}
                                        dataKey="timeKey"
                                        type={isComparisonActive ? "default" : "stacked"}
                                        series={
                                            (isComparisonActive
                                                ? [
                                                    { name: '기준데이터', color: 'blue.6', label: '기준데이터' },
                                                    { name: '비교데이터', color: 'orange.6', label: '비교데이터' }
                                                ]
                                                : (selDistributors.length > 0
                                                    ? selDistributors.map((d, i) => ({ name: d, color: ['blue.6', 'teal.6', 'violet.6', 'orange.6'][i % 4], label: d }))
                                                    : [{ name: 'Total', color: 'blue.6', label: 'Total Sales' }]
                                                )) as any
                                        }
                                        tickLine="y"
                                        withLegend
                                        gridAxis="xy"
                                        tooltipProps={{
                                            content: ({ active, payload, label }) => (
                                                <CustomTooltip
                                                    active={active}
                                                    payload={payload}
                                                    label={label}
                                                    pLabel={primaryLabel}
                                                    sLabel={secondaryLabel}
                                                />
                                            ),
                                            cursor: { stroke: 'gray', strokeWidth: 1, strokeDasharray: '5 5' }
                                        }}
                                        tooltipAnimationDuration={0}
                                        xAxisProps={{ interval: viewMode === 'Week' ? 3 : 0 }}
                                        fillOpacity={isComparisonActive ? 0.4 : 0.8}
                                        withDots
                                    />
                                </Paper>

                                {/* Data Grid with Tabs */}
                                <Tabs value={activeTab} onChange={setActiveTab} variant="outline" radius="md">
                                    <Tabs.List mb="md">
                                        <Tabs.Tab value="model" leftSection={<IconChartBar size={16} />}>By Model</Tabs.Tab>
                                        <Tabs.Tab value="distributor" leftSection={<IconBuildingWarehouse size={16} />}>By Distributor</Tabs.Tab>
                                        <Tabs.Tab value="dealer" leftSection={<IconBuildingWarehouse size={16} />}>By Dealer</Tabs.Tab>
                                    </Tabs.List>

                                    <Tabs.Panel value={activeTab || "model"}>
                                        <Paper withBorder p="md" radius="md">
                                            <ScrollArea h={500}>
                                                <Table stickyHeader highlightOnHover verticalSpacing="sm">
                                                    <Table.Thead bg="gray.1">
                                                        <Table.Tr>
                                                            <Table.Th>
                                                                {activeTab === 'model' ? "Model Name" :
                                                                    activeTab === 'distributor' ? "Distributor Name" :
                                                                        "Dealer Name"}
                                                            </Table.Th>
                                                            {activeTab === 'model' && <Table.Th>Chipset</Table.Th>}
                                                            <Table.Th style={{ textAlign: 'right' }}>Total Sales (Qty)</Table.Th>
                                                        </Table.Tr>
                                                    </Table.Thead>
                                                    <Table.Tbody>
                                                        {tableData.map((row, idx) => (
                                                            <Table.Tr key={idx}>
                                                                <Table.Td fw={500}>{row.key}</Table.Td>
                                                                {activeTab === 'model' && <Table.Td>{row.chipset}</Table.Td>}
                                                                <Table.Td style={{ textAlign: 'right' }}>{row.sales.toLocaleString()}</Table.Td>
                                                            </Table.Tr>
                                                        ))}
                                                        {tableData.length === 0 && (
                                                            <Table.Tr>
                                                                <Table.Td colSpan={3} ta="center" py="xl" c="dimmed">
                                                                    No data for current filters
                                                                </Table.Td>
                                                            </Table.Tr>
                                                        )}
                                                    </Table.Tbody>
                                                </Table>
                                            </ScrollArea>
                                        </Paper>
                                    </Tabs.Panel>
                                </Tabs>
                            </Tabs.Panel>

                            <Tabs.Panel value="analysis" pt="md">
                                {/* Existing Analysis Panel Content */}
                                <Paper withBorder p="md" radius="md">
                                    <Group justify="space-between" mb="md">
                                        <Group>
                                            <Title order={5}>재고 분석 및 오더 제안</Title>
                                            <Badge color="blue" variant="light">
                                                기준: {refWeek ? refWeek.replace(/(\d{4})년 (\d{1,2})주차|(\d{4})\.(\d{1,2})/, (match, y1, w1, y2, w2) => {
                                                    const y = y1 || y2;
                                                    const w = w1 || w2;
                                                    return `${y}.W${String(w).padStart(2, '0')}`;
                                                }) : 'N/A'}
                                            </Badge>
                                            <Badge color="gray" variant="light">
                                                {analysisDataComputed.dateRangeStr || 'N/A'}
                                            </Badge>
                                            <Button
                                                size="xs"
                                                variant="subtle"
                                                color="gray"
                                                leftSection={<IconDownload size={14} />}
                                                onClick={() => {
                                                    if (!analysisDataComputed.rawSales) return;
                                                    const worksheet = XLSX.utils.json_to_sheet(analysisDataComputed.rawSales);
                                                    const workbook = XLSX.utils.book_new();
                                                    XLSX.utils.book_append_sheet(workbook, worksheet, "AnalysisRaw");
                                                    XLSX.writeFile(workbook, `runrate_raw_data_${analysisDataComputed.refWeek}.xlsx`);
                                                }}
                                            >
                                                계산 근거 데이터(Raw) 다운로드
                                            </Button>
                                        </Group>
                                        <Group>
                                            <NumberInput
                                                label="목표 재고(주)"
                                                value={targetWeeks}
                                                onChange={(val) => setTargetWeeks(Number(val) || 0)}
                                                min={1}
                                                w={120}
                                                size="xs"
                                                allowDecimal={false}
                                            />
                                            <NumberInput
                                                label="Run-rate 기준(주)"
                                                value={runRateBasis}
                                                onChange={(val) => setRunRateBasis(Number(val) || 0)}
                                                min={1}
                                                max={52}
                                                w={140}
                                                size="xs"
                                                allowDecimal={false}
                                            />
                                        </Group>
                                    </Group>

                                    <Table striped highlightOnHover withTableBorder withColumnBorders>
                                        <Table.Thead bg="gray.1">
                                            <Table.Tr>
                                                <Table.Th>Model Name</Table.Th>
                                                <Table.Th>Product</Table.Th>
                                                <Table.Th>Chipset</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>Run-rate ({runRateBasis}주 평균)</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>PO</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>OTW</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>Current Stock</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }} bg="blue.1">Total (합계)</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>재고 수준 (Weeks)</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>추천 오더 (EA)</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {/* [New] Grand Total Row */}
                                            {filteredAnalysisTable.length > 0 && (
                                                <Table.Tr bg="gray.3" style={{ borderBottom: '2px solid #dee2e6' }}>
                                                    <Table.Td fw={900} colSpan={3} style={{ textAlign: 'center', color: '#333' }}>Total (전체)</Table.Td>
                                                    <Table.Td style={{ textAlign: 'right', fontWeight: 900 }}>
                                                        {filteredAnalysisTable.reduce((acc: number, item: any) => acc + item.runRate, 0).toFixed(1)}
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right', fontWeight: 900 }}>
                                                        {new Intl.NumberFormat().format(filteredAnalysisTable.reduce((acc: number, item: any) => acc + item.po, 0))}
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right', fontWeight: 900 }}>
                                                        {new Intl.NumberFormat().format(filteredAnalysisTable.reduce((acc: number, item: any) => acc + item.otw, 0))}
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right', fontWeight: 900 }}>
                                                        {new Intl.NumberFormat().format(filteredAnalysisTable.reduce((acc: number, item: any) => acc + item.stock, 0))}
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right', fontWeight: 900 }} bg="blue.2">
                                                        {new Intl.NumberFormat().format(filteredAnalysisTable.reduce((acc: number, item: any) => acc + item.po + item.otw + item.stock, 0))}
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right' }}>-</Table.Td>
                                                    <Table.Td style={{ textAlign: 'right', fontWeight: 900 }} c="blue.7">
                                                        +{new Intl.NumberFormat().format(filteredAnalysisTable.reduce((acc: number, item: any) => acc + item.suggestion, 0))}
                                                    </Table.Td>
                                                </Table.Tr>
                                            )}

                                            {filteredAnalysisTable.length > 0 ? (
                                                filteredAnalysisTable.map((item: any) => (
                                                    <Table.Tr key={item.modelName}>
                                                        <Table.Td fw={500}>{item.modelName}</Table.Td>
                                                        <Table.Td><Text size="xs" c="dimmed">{item.product}</Text></Table.Td>
                                                        <Table.Td><Text size="xs" c="dimmed">{item.chipset}</Text></Table.Td>
                                                        <Table.Td style={{ textAlign: 'right' }}>{item.runRate.toFixed(1)}</Table.Td>
                                                        <Table.Td style={{ textAlign: 'right' }}>{new Intl.NumberFormat().format(item.po)}</Table.Td>
                                                        <Table.Td style={{ textAlign: 'right' }}>{new Intl.NumberFormat().format(item.otw)}</Table.Td>
                                                        <Table.Td style={{ textAlign: 'right' }}>{new Intl.NumberFormat().format(item.stock)}</Table.Td>
                                                        <Table.Td style={{ textAlign: 'right' }} fw={700} bg="blue.0">{new Intl.NumberFormat().format(item.po + item.otw + item.stock)}</Table.Td>
                                                        <Table.Td style={{ textAlign: 'right' }} c={item.wos < 3 ? 'red' : 'dark'}>
                                                            {item.wos > 100 ? '99+' : item.wos.toFixed(1)} wks
                                                        </Table.Td>
                                                        <Table.Td style={{ textAlign: 'right' }} fw={700} c={item.suggestion > 0 ? 'blue' : 'gray.5'}>
                                                            {item.suggestion > 0 ? `+${new Intl.NumberFormat().format(item.suggestion)}` : '-'}
                                                        </Table.Td>
                                                    </Table.Tr>
                                                ))
                                            ) : (
                                                <Table.Tr>
                                                    <Table.Td colSpan={10} style={{ textAlign: 'center' }}>데이터가 충분하지 않습니다. (판매 데이터 필요)</Table.Td>
                                                </Table.Tr>
                                            )}
                                        </Table.Tbody>
                                    </Table>
                                </Paper>
                            </Tabs.Panel>

                            <Tabs.Panel value="raw" pt="md">
                                <Paper withBorder p="md" radius="md">
                                    <Group justify="space-between" mb="md">
                                        <Group>
                                            <Title order={5}>원본 데이터 조회 (Raw Data)</Title>
                                            <Badge color="gray">{weeklyData.length.toLocaleString()} Total Rows</Badge>
                                            <Badge color="blue">{filteredWeekly.length.toLocaleString()} Filtered Rows</Badge>
                                        </Group>
                                        <Button
                                            variant="light"
                                            leftSection={<IconDownload size={14} />}
                                            onClick={() => {
                                                const worksheet = XLSX.utils.json_to_sheet(filteredWeekly);
                                                const workbook = XLSX.utils.book_new();
                                                XLSX.utils.book_append_sheet(workbook, worksheet, "RawData");
                                                XLSX.writeFile(workbook, `raw_data_export_${new Date().toISOString().split('T')[0]}.xlsx`);
                                            }}
                                        >
                                            엑셀 내보내기
                                        </Button>
                                    </Group>

                                    <ScrollArea h={600}>
                                        <Table stickyHeader highlightOnHover withTableBorder>
                                            <Table.Thead bg="gray.1">
                                                <Table.Tr>
                                                    <Table.Th w={60}>Row</Table.Th>
                                                    <Table.Th w={120}>Date</Table.Th>
                                                    <Table.Th w={150}>Distributor</Table.Th>
                                                    <Table.Th>Model Name</Table.Th>
                                                    <Table.Th w={100} style={{ textAlign: 'right' }}>Qty</Table.Th>
                                                    <Table.Th w={120}>Type</Table.Th>
                                                    <Table.Th w={150}>Status</Table.Th>
                                                </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                                {filteredWeekly.slice(0, 1000).map((row: any, idx) => (
                                                    <Table.Tr key={row.id || row.key || idx}>
                                                        <Table.Td>{row.rowIndex || '-'}</Table.Td>
                                                        <Table.Td>{(row.date as any) instanceof Date ? toDateString(row.date) : (row.date || 'N/A')}</Table.Td>
                                                        <Table.Td>{row.distributor}</Table.Td>
                                                        <Table.Td fw={500}>{row.modelName}</Table.Td>
                                                        <Table.Td style={{ textAlign: 'right' }}>{row.qty.toLocaleString()}</Table.Td>
                                                        <Table.Td>{row.categoryType}</Table.Td>
                                                        <Table.Td>
                                                            <Badge
                                                                size="xs"
                                                                color={row.status?.includes('정상') ? 'green' : 'orange'}
                                                                variant="dot"
                                                            >
                                                                {row.status || '정상'}
                                                            </Badge>
                                                        </Table.Td>
                                                    </Table.Tr>
                                                ))}
                                                {filteredWeekly.length > 1000 && (
                                                    <Table.Tr>
                                                        <Table.Td colSpan={7} ta="center" py="md" bg="gray.0">
                                                            <Text size="xs" c="dimmed">
                                                                상위 1,000개의 행만 표시됩니다. 전체 데이터는 엑셀 내보내기를 이용하세요.
                                                            </Text>
                                                        </Table.Td>
                                                    </Table.Tr>
                                                )}
                                                {filteredWeekly.length === 0 && (
                                                    <Table.Tr>
                                                        <Table.Td colSpan={7} ta="center" py="xl">
                                                            조회된 데이터가 없습니다.
                                                        </Table.Td>
                                                    </Table.Tr>
                                                )}
                                            </Table.Tbody>
                                        </Table>
                                    </ScrollArea>

                                    <Paper withBorder p="sm" mt="md" bg="blue.0">
                                        <Group justify="space-between">
                                            <Text size="sm" fw={700}>현재 필터링된 판매량 합계:</Text>
                                            <Text size="lg" fw={900} c="blue.7">
                                                {filteredWeekly.reduce((acc, curr) => acc + (curr.qty || 0), 0).toLocaleString()} EA
                                            </Text>
                                        </Group>
                                    </Paper>
                                </Paper>
                            </Tabs.Panel>
                        </Tabs>
                    </>
                )
            }
        </Container >
    );
}
