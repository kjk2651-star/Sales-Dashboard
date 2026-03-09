import { ref, uploadString, getBytes } from "firebase/storage";
import { storage } from "../lib/firebase";
import { WeeklyData, MarketItem, MarketHistory } from "@/types/data";

const DEFAULT_FILE_PATH = 'dashboard_data.json';

// [Cache] Memory variable (persists while app is running)
// Now stores cache per fileKey: { "dashboard_data.json": data, "dashboard_data_others.json": data2 }
let cachedData: Record<string, any> = {};

export const storageService = {
    // Load Data
    loadData: async (forceRefresh = false, fileKey = DEFAULT_FILE_PATH) => {
        try {
            // 1. Return Cache if available
            if (cachedData[fileKey] && !forceRefresh) {
                console.log(`⚡ [Cache] Returning data from memory for ${fileKey} (Instant Load).`);
                return cachedData[fileKey];
            }

            console.log(`📥 [Download] Fetching from Firebase Storage (${fileKey})...`);
            const fileRef = ref(storage, fileKey);

            // 2. Download as Bytes (Avoid CORS)
            const bytes = await getBytes(fileRef);
            // 3. Convert to JSON
            const jsonStr = new TextDecoder().decode(bytes);
            const data = JSON.parse(jsonStr);

            // 4. Update Cache
            cachedData[fileKey] = data;
            console.log(`✅ [Download] Data cached for ${fileKey}.`);

            return data;

        } catch (error: any) {
            // If file doesn't exist (First use), return null (Not an error)
            if (error.code === 'storage/object-not-found') {
                console.log(`ℹ️ [Service] No saved data found for ${fileKey} (New User). Returning null.`);
                cachedData[fileKey] = null; // Clear cache for this key
                return null;
            }
            console.error(`❌ Load Error (${fileKey}):`, error);
            throw error;
        }
    },

    // Save Data (Replace & Upload)
    saveData: async (newWeeklyData: WeeklyData[], newSnapshot: any, analysisResult: any[], referenceWeek?: string, fileKey = DEFAULT_FILE_PATH) => {
        try {
            // 업로드된 데이터로 완전 교체 (누적 방지)
            console.log(`✅ Replacing Data (${fileKey}): New ${newWeeklyData.length} rows`);

            const finalData = {
                weeklyData: newWeeklyData,
                currentSnapshot: newSnapshot,
                analysisResult: analysisResult,
                referenceWeek: referenceWeek || "N/A",
                updatedAt: new Date().toISOString()
            };

            // Upload
            const fileRef = ref(storage, fileKey);
            await uploadString(fileRef, JSON.stringify(finalData), 'raw', { contentType: 'application/json' });

            // [Cache] Update Cache with new data
            cachedData[fileKey] = finalData;
            console.log(`✅ Data saved to Storage & Cache updated for ${fileKey}.`);

            return newWeeklyData;

        } catch (error) {
            console.error(`❌ Save Error (${fileKey}):`, error);
            throw error;
        }
    },

    // Optional: Clear Cache manually
    clearCache: (fileKey?: string) => {
        if (fileKey) {
            delete cachedData[fileKey];
            console.log(`🧹 Cache cleared for ${fileKey}.`);
        } else {
            cachedData = {};
            console.log("🧹 All caches cleared.");
        }
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
