// Weekly Channel Data (Sales & Inventory Flow)
export interface WeeklyData {
    id?: string;         // 고유 ID (ROW_INDEX_DATE_MODEL 형식)
    distributor: string; // 총판 (DISTISUBNAME)
    modelName: string;   // 모델명
    chipset: string;     // Chipset
    qty: number;         // 수량
    year: number;        // 연도
    month?: number;      // 월 (Optional, parsed from Excel)
    week: number;        // 주차
    type: 'sales' | 'inventory'; // 데이터 타입
    dealerName?: string; // 판매처 (Dealer)
    categoryType?: string; // 타입 (B2B, B2C etc)
    product?: string;    // 품목 (Product)
    date?: string;       // 실제 판매 날짜 (YYYY-MM-DD)
    sell_out?: number;   // [Optional] Sell-out 수량 (Legacy support)
    status?: string;     // [Debug] 상태 (누락 사유 등)
    rowIndex?: number;   // [Debug] 엑셀 행 번호
    rawDate?: any;       // [Debug] 원본 날짜 데이터
}

// Current Snapshot Data (Internal Stock & Backlog)
export interface SnapshotData {
    modelName: string;      // 모델명 (Item)
    chipset: string;        // Chipset
    availableStock: number; // 정상가용
    totalStock: number;     // 합계수량
    incomingQty: number;    // 입고예정 수량 (Backlog)
    incomingAmount: number; // 입고예정 금액
    distributor?: string;   // 총판 (Optional, for granular analysis)
    product?: string;       // [New] 품목 (Product)
    poQty?: number;         // [New] PO 수량 (from Backlog)
    otwQty?: number;        // [New] OTW 수량 (from Backlog)
}

export interface ParsedExcelResult {
    weeklyData: WeeklyData[];
    snapshotData: SnapshotData[];
    distributors: string[]; // Detected distributors list
    referenceWeek?: string; // Parsed reference week from header (e.g., "2026-W01")
}

export interface MarketItem {
    productNo?: string; // Optional for now as legacy might not have it
    category: string; // cpu, psu, os 등
    brand: string;
    model: string;
    spec: string;
    price: number;
    productUrl?: string;
}

export interface MarketHistory {
    date: string; // YYYY-MM-DD
    items: MarketItem[];
}
