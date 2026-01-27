import { ref, uploadString, getBytes } from "firebase/storage";
import { storage } from "../lib/firebase";
import { WeeklyData, MarketItem, MarketHistory } from "@/types/data";

const FILE_PATH = 'dashboard_data.json';

// [Cache] Memory variable (persists while app is running)
let cachedData: any = null;

export const storageService = {
    // Load Data
    loadData: async (forceRefresh = false) => {
        try {
            // 1. Return Cache if available
            if (cachedData && !forceRefresh) {
                console.log("⚡ [Cache] Returning data from memory (Instant Load).");
                return cachedData;
            }

            console.log("📥 [Download] Fetching from Firebase Storage...");
            const fileRef = ref(storage, FILE_PATH);

            // 2. Download as Bytes (Avoid CORS)
            const bytes = await getBytes(fileRef);
            // 3. Convert to JSON
            const jsonStr = new TextDecoder().decode(bytes);
            const data = JSON.parse(jsonStr);

            // 4. Update Cache
            cachedData = data;
            console.log("✅ [Download] Data cached.");

            return data;

        } catch (error: any) {
            // If file doesn't exist (First use), return null (Not an error)
            if (error.code === 'storage/object-not-found') {
                console.log("ℹ️ [Service] No saved data found (New User). Returning null.");
                cachedData = null; // Clear cache
                return null;
            }
            console.error("❌ Load Error:", error);
            throw error;
        }
    },

    // Save Data (Merge & Upload)
    saveData: async (newWeeklyData: WeeklyData[], newSnapshot: any, analysisResult: any[], referenceWeek?: string) => {
        try {
            // 1. Load Existing Data (Use Cache logic inside loadData)
            let existingWeekly: WeeklyData[] = [];
            try {
                const currentData = await storageService.loadData();
                if (currentData && currentData.weeklyData) {
                    existingWeekly = currentData.weeklyData;
                }
            } catch (e) { /* Ignore load error on save */ }

            // 2. Merge Data (De-duplication)
            // Key: Year-Week-Distributor-Model-Dealer-Type-Product
            const uniqueMap = new Map<string, WeeklyData>();

            // Helper to generate Unique Key (Includes id/date/rowIndex for better distinctness)
            const genKey = (d: WeeklyData) => {
                // If there's a pre-calculated ID from UI (e.g. ROW_8_...), use it as the primary key
                if (d.id) return d.id;

                // Fallback for older data or different types
                const base = `${d.year}_${d.week}_${d.distributor}_${d.modelName}_${d.dealerName || ''}_${d.categoryType || ''}_${d.product || ''}`;
                const detail = `${d.date || ''}_${d.rowIndex || ''}`;
                return `${base}_${detail}`;
            };

            // Add Existing Data to Map
            existingWeekly.forEach(d => {
                uniqueMap.set(genKey(d), d);
            });

            // Overwrite/Add New Data
            newWeeklyData.forEach(d => {
                uniqueMap.set(genKey(d), d);
            });

            const mergedWeekly = Array.from(uniqueMap.values());
            console.log(`✅ Merged Data: Existing ${existingWeekly.length} + New ${newWeeklyData.length} -> Final ${mergedWeekly.length}`);

            const finalData = {
                weeklyData: mergedWeekly,
                currentSnapshot: newSnapshot, // Snapshot is always replaced by latest
                analysisResult: analysisResult, // Persist calculated verification data
                referenceWeek: referenceWeek || "N/A",
                updatedAt: new Date().toISOString()
            };

            // 3. Upload
            const fileRef = ref(storage, FILE_PATH);
            await uploadString(fileRef, JSON.stringify(finalData), 'raw', { contentType: 'application/json' });

            // [Cache] Update Cache with new data
            cachedData = finalData;
            console.log("✅ Data saved to Storage & Cache updated.");

            return mergedWeekly;

        } catch (error) {
            console.error("❌ Save Error:", error);
            throw error;
        }
    },

    // Optional: Clear Cache manually
    clearCache: () => {
        cachedData = null;
        console.log("🧹 Cache cleared.");
    },

    // --- Market Price History ---

    loadMarketData: async (): Promise<import("@/types/data").MarketHistory[]> => {
        const MARKET_FILE = 'market_price_history.json';
        try {
            const fileRef = ref(storage, MARKET_FILE);
            const bytes = await getBytes(fileRef);
            const jsonStr = new TextDecoder().decode(bytes);
            return JSON.parse(jsonStr);
        } catch (error: any) {
            if (error.code === 'storage/object-not-found') return [];
            console.error("Market Load Error:", error);
            return [];
        }
    },

    saveMarketData: async (newItems: MarketItem[], date: string) => {
        const MARKET_FILE = 'market_price_history.json';
        try {
            // 1. Load Data
            const data = await storageService.loadMarketData();

            // 2. Normalize New Items (Force Price to Number, Trim Strings)
            const cleanNewItems = newItems.map(item => ({
                ...item,
                model: item.model.trim(),
                brand: item.brand.trim(),
                // Robust Number Parsing
                price: typeof item.price === 'string'
                    ? Number(String(item.price).replace(/[^0-9]/g, ''))
                    : Number(item.price) || 0
            }));

            // 3. Remove existing entry for this date (to overwrite)
            // We use the date string as the unique key for the history entry
            const otherDates = data.filter(h => h.date !== date);

            // 4. Create new history entry
            const newEntry: MarketHistory = {
                date: date,
                items: cleanNewItems
            };

            // 5. Merge
            const updatedHistory = [...otherDates, newEntry];

            // 6. Strict Sort by Date (Ascending: Old -> New)
            updatedHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            // 7. Save
            const jsonString = JSON.stringify(updatedHistory);
            const storageRef = ref(storage, MARKET_FILE);
            await uploadString(storageRef, jsonString, 'raw', { contentType: 'application/json' });
            console.log(`✅ [Market] Saved ${cleanNewItems.length} items for ${date}. Total dates: ${updatedHistory.length}`);

        } catch (error) {
            console.error('Failed to save market data:', error);
            throw error;
        }
    }
};
