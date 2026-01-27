'use client';

import { useState, useEffect, useMemo } from 'react';
import {
    Title, Card, Button, Group, Select, Table, Badge, ScrollArea, LoadingOverlay, Text, FileButton, Container, Grid, MultiSelect, Paper, Alert, List, ThemeIcon, Tabs
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconUpload, IconFileSpreadsheet, IconChartLine, IconCheck, IconX, IconFilter, IconChartBar, IconInfoCircle } from '@tabler/icons-react';
import {
    BarChart, Bar, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, LineChart, Line
} from 'recharts';
import * as XLSX from 'xlsx';
import { storageService } from '@/services/storageService';
import { MarketHistory, MarketItem } from '@/types/data';
import { notifications } from '@mantine/notifications';
import '@mantine/dates/styles.css';

// --- Constants & Config ---


const BRAND_COLORS: Record<string, string> = {
    'ASUS': '#e02424', 'MSI': '#0057b8', 'GIGABYTE': '#fa8c16', 'ASRock': '#7cb305',
    'GALAX': '#bfbfbf', 'COLORFUL': '#eb2f96', 'ZOTAC': '#fadb14', 'PALIT': '#262626',
    'MANLI': '#389e0d', 'AMD': '#ed1c24', 'INTEL': '#0071c5', 'EMTEK': '#1890ff'
};
const PALETTE = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c', '#d0ed57', '#ffc0cb'];
const MB_DEFAULT_BRANDS = ['ASUS', 'MSI', 'GIGABYTE', 'ASRock'];
const VGA_DEFAULT_BRANDS = ['ASUS', 'MSI', 'GIGABYTE', 'MANLI', 'GALAX', 'COLORFUL', 'ZOTAC', 'PALIT'];
const CHART_COLORS = [
    '#dc2626', // 빨강 (Red)
    '#2563eb', // 파랑 (Blue)
    '#16a34a', // 초록 (Green)
    '#d97706', // 주황 (Orange)
    '#9333ea', // 보라 (Purple)
    '#0891b2', // 청록 (Cyan)
    '#db2777', // 핑크 (Pink)
    '#4b5563', // 회색 (Gray)
    '#000000', // 검정 (Black)
];

// --- Custom Tooltip Component ---
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <Paper p="sm" withBorder shadow="md" style={{ backgroundColor: 'white', minWidth: 200, zIndex: 1000 }}>
                <Text fw={700} mb={5} size="sm">{label}</Text>
                {payload.map((entry: any, index: number) => (
                    <Group key={index} justify="space-between" mb={2}>
                        {/* Show original Name (from entry.name) */}
                        <Text size="xs" c={entry.color} fw={500}>{entry.name}</Text>
                        <Text size="xs" fw={700}>{new Intl.NumberFormat().format(entry.value)}원</Text>
                    </Group>
                ))}
            </Paper>
        );
    }
    return null;
};

export default function MarketPricePage() {
    const [history, setHistory] = useState<MarketHistory[]>([]);
    const [loading, setLoading] = useState(false);

    // Upload
    const [uploadDate, setUploadDate] = useState<Date | null>(new Date());
    const [uploadResults, setUploadResults] = useState<{ name: string, status: 'success' | 'error', msg: string }[]>([]);

    // Main Chart Filters
    const [selCategory, setSelCategory] = useState<string | null>(null);
    const [selBrand, setSelBrand] = useState<string | null>(null);
    const [selProducts, setSelProducts] = useState<string[]>([]);

    // Analysis Filters
    const [selChipsets, setSelChipsets] = useState<string[]>([]);
    const [selAnalysisBrands, setSelAnalysisBrands] = useState<string[]>([]);

    // 1. Initial Load
    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await storageService.loadMarketData();
            // Force Timestamp Sort
            const sorted = data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            setHistory(sorted);

            if (sorted.length > 0 && !selCategory) {
                for (let i = sorted.length - 1; i >= 0; i--) {
                    if (sorted[i].items.length > 0) {
                        setSelCategory(sorted[i].items[0].category);
                        break;
                    }
                }
            }
        } catch (e) {
            console.error(e);
            notifications.show({ title: 'Error', message: 'Failed to load history', color: 'red' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selCategory === 'MB') setSelAnalysisBrands(MB_DEFAULT_BRANDS);
        else if (selCategory === 'VGA') setSelAnalysisBrands(VGA_DEFAULT_BRANDS);
        else setSelAnalysisBrands([]);
    }, [selCategory]);


    // 2. Helpers
    const detectCategory = (filename: string): string => {
        const lower = filename.toLowerCase();
        if (lower.includes('cpu')) return 'CPU';
        if (lower.includes('psu') || lower.includes('power')) return 'PSU';
        if (lower.includes('mb') || lower.includes('mainboard')) return 'MB';
        if (lower.includes('vga') || lower.includes('gpu') || lower.includes('graphic')) return 'VGA';
        if (lower.includes('ram') || lower.includes('memory')) return 'RAM';
        if (lower.includes('ssd') || lower.includes('hdd')) return 'SSD';
        if (lower.includes('os') || lower.includes('win')) return 'OS';
        return 'UNKNOWN';
    };

    const parseDateFromFilename = (filename: string, defaultDate: Date | null): string => {
        const matchFull = filename.match(/_(\d{4})(\d{2})(\d{2})/);
        if (matchFull) return `${matchFull[1]}-${matchFull[2]}-${matchFull[3]}`;

        const matchShort = filename.match(/_(\d{2})(\d{2})/);
        if (matchShort) {
            const currentYear = new Date().getFullYear();
            return `${currentYear}-${matchShort[1]}-${matchShort[2]}`;
        }
        return defaultDate ? defaultDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    };

    const handleFileUpload = async (files: File[]) => {
        if (files.length === 0) return;
        setLoading(true);
        setUploadResults([]);
        const results: { name: string, status: 'success' | 'error', msg: string }[] = [];
        const batchMap = new Map<string, MarketItem[]>();

        try {
            for (const file of files) {
                try {
                    const category = detectCategory(file.name);
                    if (category === 'UNKNOWN') {
                        results.push({ name: file.name, status: 'error', msg: 'Unknown Category' });
                        continue;
                    }
                    const targetDate = parseDateFromFilename(file.name, uploadDate);
                    const buffer = await file.arrayBuffer();
                    const workbook = XLSX.read(buffer, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows: any[] = XLSX.utils.sheet_to_json(firstSheet);
                    const newItems: MarketItem[] = [];
                    const normalize = (key: string) => key?.toUpperCase().replace(/\s/g, '');

                    rows.forEach((row: any) => {
                        const keys = Object.keys(row);
                        const colBrand = keys.find(k => normalize(k).includes('BRAND') || normalize(k).includes('제조사'));
                        const colModel = keys.find(k => normalize(k).includes('MODEL') || normalize(k) === '제품명');
                        const colPrice = keys.find(k => normalize(k).includes('PRICE') || normalize(k).includes('가격') || normalize(k).includes('최저가'));

                        let specVal = '';
                        const colChipset = keys.find(k => normalize(k) === 'CHIPSET' || normalize(k).includes('칩셋'));
                        const colSpec = keys.find(k => normalize(k).includes('SPEC') || normalize(k) === '규격');

                        if (colChipset) specVal = String(row[colChipset]).trim();
                        else if (colSpec) specVal = String(row[colSpec]).trim();
                        else {
                            const colWatt = keys.find(k => normalize(k).includes('WATT'));
                            const colVer = keys.find(k => normalize(k).includes('VERSION'));
                            if (colWatt) specVal = String(row[colWatt]).trim();
                            else if (colVer) specVal = String(row[colVer]).trim();
                        }

                        if (colModel && colPrice) {
                            newItems.push({
                                category: category,
                                brand: colBrand ? String(row[colBrand]).trim() : 'Unknown',
                                model: String(row[colModel]).trim(),
                                spec: specVal,
                                price: parseFloat(String(row[colPrice]).replace(/,/g, '')) || 0
                            });
                        }
                    });

                    if (newItems.length > 0) {
                        if (!batchMap.has(targetDate)) batchMap.set(targetDate, []);
                        batchMap.get(targetDate)!.push(...newItems);
                        results.push({ name: file.name, status: 'success', msg: `${newItems.length} parsed (${targetDate})` });
                    } else {
                        results.push({ name: file.name, status: 'error', msg: 'No valid rows' });
                    }
                } catch (err: any) {
                    results.push({ name: file.name, status: 'error', msg: 'Parse Error' });
                }
            }
            setUploadResults(results);
            for (const [dateStr, items] of batchMap.entries()) {
                await storageService.saveMarketData(items, dateStr);
            }
            if (batchMap.size > 0) {
                notifications.show({ title: 'Complete', message: `Saved data for ${batchMap.size} dates.`, color: 'green' });
                await loadData();
            }
        } catch (e) {
            console.error(e);
            notifications.show({ title: 'Error', message: 'Upload failed.', color: 'red' });
        } finally {
            setLoading(false);
        }
    };

    // 3. Derived Data
    const uniqueCategories = useMemo(() => {
        const cats = new Set<string>();
        history.forEach(h => h.items.forEach(i => cats.add(i.category)));
        return Array.from(cats).sort();
    }, [history]);

    const uniqueBrands = useMemo(() => {
        if (!selCategory) return [];
        const brands = new Set<string>();
        history.forEach(h => h.items.forEach(i => { if (i.category === selCategory) brands.add(i.brand); }));
        return Array.from(brands).sort();
    }, [history, selCategory]);

    const uniqueModels = useMemo(() => {
        if (!selCategory) return [];
        const models = new Set<string>();
        history.forEach(h => h.items.forEach(i => {
            if (i.category === selCategory &&
                (!selBrand || i.brand === selBrand) &&
                (selChipsets.length === 0 || (i.spec && selChipsets.includes(i.spec)))
            ) {
                models.add(i.model);
            }
        }));
        return Array.from(models).sort();
    }, [history, selCategory, selBrand, selChipsets]);

    const uniqueChipsets = useMemo(() => {
        if (!selCategory || (selCategory !== 'MB' && selCategory !== 'VGA')) return [];
        const specs = new Set<string>();
        history.forEach(h => h.items.forEach(i => {
            if (i.category === selCategory && i.spec) specs.add(i.spec);
        }));
        return Array.from(specs).sort();
    }, [history, selCategory]);

    // -- [수정됨] 1. Safe Keys (단순화 매핑) --
    const safeKeyMap = useMemo(() => {
        return selProducts.reduce((acc, model, index) => {
            acc[model] = `line_${index}`;
            return acc;
        }, {} as Record<string, string>);
    }, [selProducts]);

    // -- [수정됨] 2. Chart Data (날짜 정렬 + 숫자 변환) --
    const chartData = useMemo(() => {
        if (!selCategory || selProducts.length === 0 || history.length === 0) return [];

        // (1) 존재하는 모든 날짜 수집 및 오름차순 정렬
        const allDates = Array.from(new Set(history.map(h => h.date))).sort(
            (a, b) => new Date(a).getTime() - new Date(b).getTime()
        );

        // (2) 날짜별 데이터 생성
        return allDates.map(dateStr => {
            const entry: any = { date: dateStr };
            const historyItem = history.find(h => h.date === dateStr);

            selProducts.forEach(model => {
                const simpleKey = safeKeyMap[model];
                const item = historyItem?.items.find(i =>
                    i.category === selCategory && i.model === model
                );

                if (item && item.price) {
                    const numPrice = Number(String(item.price).replace(/[^0-9]/g, ''));
                    entry[simpleKey] = (!isNaN(numPrice) && numPrice > 0) ? numPrice : null;
                } else {
                    entry[simpleKey] = null;
                }
            });
            return entry;
        });
    }, [history, selCategory, selProducts, safeKeyMap]);

    // Analysis Data
    const brandAverageData = useMemo(() => {
        if (!selCategory || history.length === 0) return [];
        const latestHist = history[history.length - 1];
        if (!latestHist) return [];

        const relevantItems = latestHist.items.filter(i => {
            if (i.category !== selCategory) return false;
            if (selChipsets.length > 0) {
                if (!i.spec) return false;
                if (!selChipsets.includes(i.spec)) return false;
            }
            if (selAnalysisBrands.length > 0 && !selAnalysisBrands.includes(i.brand)) return false;
            return true;
        });

        const brandMap = new Map<string, { total: number, count: number }>();
        relevantItems.forEach(i => {
            if (!brandMap.has(i.brand)) brandMap.set(i.brand, { total: 0, count: 0 });
            const entry = brandMap.get(i.brand)!;
            entry.total += i.price;
            entry.count += 1;
        });

        let res = Array.from(brandMap.entries()).map(([brand, val]) => ({
            brand,
            avgPrice: Math.round(val.total / val.count)
        })).sort((a, b) => b.avgPrice - a.avgPrice);

        return res;
    }, [history, selCategory, selChipsets, selAnalysisBrands]);

    const brandTrendData = useMemo(() => {
        if (!selCategory) return [];

        const mapped = history.map(h => {
            const point: any = { date: h.date, originalDate: new Date(h.date) };
            const relevantItems = h.items.filter(i => {
                if (i.category !== selCategory) return false;
                if (selChipsets.length > 0) {
                    if (!i.spec) return false;
                    if (!selChipsets.includes(i.spec)) return false;
                }
                if (selAnalysisBrands.length > 0 && !selAnalysisBrands.includes(i.brand)) return false;
                return true;
            });

            const dailyMap = new Map<string, { total: number, count: number }>();
            relevantItems.forEach(i => {
                if (!dailyMap.has(i.brand)) dailyMap.set(i.brand, { total: 0, count: 0 });
                const entry = dailyMap.get(i.brand)!;
                entry.total += i.price;
                entry.count += 1;
            });

            dailyMap.forEach((val, brand) => {
                point[brand] = Math.round(val.total / val.count);
            });
            return point;
        });

        return mapped.sort((a, b) => a.originalDate.getTime() - b.originalDate.getTime());
    }, [history, selCategory, selChipsets, selAnalysisBrands]);

    const brandTrendSeries = useMemo(() => {
        if (!brandTrendData.length) return [];
        const allKeys = new Set<string>();
        brandTrendData.forEach(d => Object.keys(d).forEach(k => {
            if (k !== 'date' && k !== 'originalDate') allKeys.add(k);
        }));

        return Array.from(allKeys).map((brand, idx) => ({
            name: brand,
            color: BRAND_COLORS[brand] || PALETTE[idx % PALETTE.length],
            label: brand
        }));
    }, [brandTrendData]);

    // Table Data
    const globalLatestDate = useMemo(() => {
        if (history.length === 0) return '';
        return history[history.length - 1].date;
    }, [history]);

    // -- [New] 3. Price Volatility TOP 10 (Gainers/Losers) --
    const priceVolatility = useMemo(() => {
        if (history.length < 2 || !selCategory) return { gainers: [], losers: [] };

        const allDates = Array.from(new Set(history.map(h => h.date))).sort(
            (a, b) => new Date(b).getTime() - new Date(a).getTime() // Latest first
        );

        if (allDates.length < 2) return { gainers: [], losers: [] };

        const d1 = allDates[0]; // Latest
        const d2 = allDates[1]; // Previous

        const h1 = history.find(h => h.date === d1);
        const h2 = history.find(h => h.date === d2);

        if (!h1 || !h2) return { gainers: [], losers: [] };

        const diffs: any[] = [];

        // Use h1 (latest) as base to find current products
        h1.items.forEach(item1 => {
            if (item1.category !== selCategory) return;
            if (selBrand && item1.brand !== selBrand) return;
            if (selChipsets.length > 0 && (!item1.spec || !selChipsets.includes(item1.spec))) return;

            // Find same product in h2
            const item2 = h2.items.find(i => i.model === item1.model && i.brand === item1.brand && i.category === item1.category);

            if (item2 && item2.price > 0 && item1.price > 0) {
                const diff = item1.price - item2.price;
                const pct = (diff / item2.price) * 100;
                if (diff !== 0) {
                    diffs.push({
                        model: item1.model,
                        brand: item1.brand,
                        oldPrice: item2.price,
                        newPrice: item1.price,
                        diff,
                        pct
                    });
                }
            }
        });

        const gainers = [...diffs].sort((a, b) => b.pct - a.pct).slice(0, 10);
        const losers = [...diffs].sort((a, b) => a.pct - b.pct).slice(0, 10);

        return { gainers, losers };
    }, [history, selCategory, selBrand, selChipsets]);
    const filteredTableData = useMemo(() => {
        if (!selCategory || history.length === 0) return [];

        const latestMap = new Map<string, MarketItem & { date: string }>();

        history.forEach(h => {
            h.items.forEach(item => {
                if (item.category === selCategory) {
                    const key = `${item.brand}|${item.model}`;
                    latestMap.set(key, { ...item, date: h.date });
                }
            });
        });

        return Array.from(latestMap.values())
            .filter(item => {
                if (selBrand && item.brand !== selBrand) return false;
                // Filter by product if selected
                if (selProducts.length > 0 && !selProducts.includes(item.model)) return false;
                return true;
            })
            .sort((a, b) => {
                const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
                if (dateDiff !== 0) return dateDiff;
                return a.brand.localeCompare(b.brand);
            });
    }, [history, selCategory, selBrand, selProducts]);

    // Formatters
    const currencyFormatter = (value: number) => {
        if (!value) return '0';
        if (value >= 10000) return `${(value / 10000).toFixed(0)}만`;
        return new Intl.NumberFormat().format(value);
    };

    const xAxisDateFormatter = (dateStr: string) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return `${d.getMonth() + 1}-${d.getDate()}`;
    };

    const tableDateFormatter = (dateStr: string) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return `${d.getMonth() + 1}-${d.getDate()}`;
    };

    return (
        <Container fluid p="md">
            <LoadingOverlay visible={loading} />

            <Group justify="space-between" mb="lg">
                <Title order={2}>📈 시장 가격 모니터링</Title>
                <Group>
                    <Paper withBorder p="xs" radius="md" bg="gray.0">
                        <Group gap="xs">
                            <Text size="sm" fw={700} mr="xs">데이터 업로드:</Text>
                            <DatePickerInput
                                placeholder="기준일" value={uploadDate} onChange={(d: any) => setUploadDate(d)} size="xs" w={110}
                            />
                            <FileButton onChange={handleFileUpload} accept=".xlsx,.xls" multiple>
                                {(props) => (
                                    <Button {...props} size="xs" leftSection={<IconUpload size={14} />}>
                                        파일 선택 (다중)
                                    </Button>
                                )}
                            </FileButton>
                        </Group>
                    </Paper>
                </Group>
            </Group>

            {uploadResults.length > 0 && (
                <List spacing="xs" size="sm" mb="md" center>
                    {uploadResults.map((res, i) => (
                        <List.Item key={i} icon={<ThemeIcon color={res.status === 'success' ? 'teal' : 'red'} size={20} radius="xl">{res.status === 'success' ? <IconCheck size={12} /> : <IconX size={12} />}</ThemeIcon>}>
                            <Text span fw={500}>{res.name}</Text>: {res.msg}
                        </List.Item>
                    ))}
                </List>
            )}

            {/* Main Analysis Section */}
            <Card withBorder radius="md" p="md" mb="xl">
                <Tabs defaultValue="product">
                    <Tabs.List mb="md">
                        <Tabs.Tab value="product" leftSection={<IconChartLine size={16} />}>제품별 가격 추이</Tabs.Tab>
                        <Tabs.Tab value="brand" leftSection={<IconChartBar size={16} />}>브랜드 시장 분석</Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value="product">
                        <Paper withBorder p="xs" mb="md" bg="gray.0" radius="md">
                            <Tabs
                                variant="pills"
                                value={selCategory}
                                onChange={(v) => {
                                    setSelCategory(v);
                                    setSelBrand(null);
                                    setSelProducts([]);
                                    setSelChipsets([]);
                                }}
                            >
                                <Tabs.List>
                                    {uniqueCategories.map(cat => (
                                        <Tabs.Tab key={cat} value={cat} px="lg">{cat}</Tabs.Tab>
                                    ))}
                                </Tabs.List>
                            </Tabs>
                        </Paper>

                        <Group mb="xs" align="flex-end">
                            <Select
                                label="1. 브랜드 (선택)" placeholder="All Brands" data={uniqueBrands} value={selBrand}
                                onChange={(v) => { setSelBrand(v); setSelProducts([]); }} searchable clearable disabled={!selCategory}
                                w={180}
                            />
                            {(selCategory === 'MB' || selCategory === 'VGA') && (
                                <MultiSelect
                                    label="2. 칩셋 필터" placeholder="칩셋 선택"
                                    data={uniqueChipsets} value={selChipsets} onChange={setSelChipsets}
                                    searchable clearable w={220}
                                />
                            )}
                            <MultiSelect
                                label={`3. 모델 선택 (${uniqueModels.length}개)`} data={uniqueModels} value={selProducts} onChange={setSelProducts}
                                searchable maxValues={5} flex={1} disabled={!selCategory}
                                placeholder="최대 5개까지 비교 가능"
                            />
                        </Group>

                        {/* Model Comparison Table (GAP) */}
                        {selProducts.length > 0 && (
                            <Paper withBorder p="sm" mb="md" radius="md" bg="blue.0">
                                <Table variant="vertical" layout="fixed" withTableBorder bg="white">
                                    <Table.Thead bg="blue.1">
                                        <Table.Tr>
                                            <Table.Th w={250}>모델명</Table.Th>
                                            <Table.Th w={180} style={{ textAlign: 'right' }}>최신 가격 (날짜)</Table.Th>
                                            <Table.Th style={{ textAlign: 'right' }}>MSRP</Table.Th>
                                            <Table.Th style={{ textAlign: 'right' }}>GAP (%)</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {selProducts.map((model, idx) => {
                                            const latestHist = history[history.length - 1];
                                            const histItem = latestHist?.items.find(i => i.model === model && i.category === selCategory);
                                            const latestPrice = histItem?.price || 0;
                                            const latestDateStr = latestHist?.date || "N/A";

                                            // Calculate GAP based on first selected model (idx 0)
                                            let gapStr = "-";
                                            let gapColor = "gray";
                                            if (idx > 0 && selProducts.length > 1) {
                                                const baseModel = selProducts[0];
                                                const basePrice = history[history.length - 1]?.items.find(i => i.model === baseModel && i.category === selCategory)?.price || 0;
                                                if (basePrice > 0 && latestPrice > 0) {
                                                    const gap = ((basePrice - latestPrice) / latestPrice) * 100;
                                                    gapStr = `${gap > 0 ? '+' : ''}${gap.toFixed(1)}%`;
                                                    gapColor = gap > 0 ? "red" : (gap < 0 ? "blue" : "gray");
                                                }
                                            }

                                            return (
                                                <Table.Tr key={model}>
                                                    <Table.Td>
                                                        <Group gap="xs">
                                                            <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                                                            <Text size="sm" fw={idx === 0 ? 700 : 400}>{model}</Text>
                                                            {idx === 0 && <Badge size="xs" variant="outline">기준</Badge>}
                                                        </Group>
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right' }}>
                                                        <Text size="sm" fw={700}>{latestPrice.toLocaleString()}원</Text>
                                                        <Text size="xs" c="dimmed">({tableDateFormatter(latestDateStr)})</Text>
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right' }}>
                                                        <Text size="sm">{latestPrice.toLocaleString()}원</Text>
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right' }}>
                                                        <Text fw={700} c={gapColor}>{gapStr}</Text>
                                                    </Table.Td>
                                                </Table.Tr>
                                            );
                                        })}
                                    </Table.Tbody>
                                </Table>
                            </Paper>
                        )}

                        <Group mb="lg" gap="xs">
                            <IconInfoCircle size={14} color="gray" />
                            <Text size="xs" c="dimmed">
                                그래프 선이 보이지 않는 경우: 2개 이상의 날짜 데이터가 필요합니다. (점만 표시됨)
                            </Text>
                        </Group>

                        {selProducts.length > 0 ? (
                            <div style={{ height: 500, width: '100%' }}>
                                <ResponsiveContainer>
                                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="date"
                                            tickFormatter={xAxisDateFormatter}
                                            padding={{ left: 30, right: 30 }}
                                            minTickGap={30}
                                        />
                                        <YAxis domain={[0, 'auto']} tickFormatter={currencyFormatter} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Legend verticalAlign="bottom" height={36} />
                                        {selProducts.map((prod, index) => (
                                            <Line
                                                key={safeKeyMap[prod]}
                                                dataKey={safeKeyMap[prod]}
                                                name={prod}
                                                type="monotone"
                                                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                                strokeWidth={3}
                                                dot={{ r: 4, strokeWidth: 1 }}
                                                activeDot={{ r: 6 }}
                                                connectNulls={true}
                                                isAnimationActive={false}
                                            />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <Alert color="blue" variant="light" icon={<IconFilter />}>모델을 선택하면 가격 변동 그래프가 표시됩니다.</Alert>
                        )}

                        {/* TOP 10 Price Changes */}
                        <Grid mt="xl" gutter="lg">
                            <Grid.Col span={{ base: 12, md: 6 }}>
                                <Paper withBorder p="md" radius="md">
                                    <Group mb="xs">
                                        <Badge color="red" variant="filled" size="lg">TOP 10 가격 상승</Badge>
                                        <Text size="xs" c="dimmed">전일 대비 (기존 카테고리/필터 내)</Text>
                                    </Group>
                                    <Table verticalSpacing="xs" highlightOnHover striped withColumnBorders withTableBorder>
                                        <Table.Thead bg="red.0">
                                            <Table.Tr>
                                                <Table.Th>제품명</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>최신 가격</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>변동률</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {priceVolatility.gainers.map((item, i) => (
                                                <Table.Tr key={item.model}>
                                                    <Table.Td>
                                                        <Text size="xs" fw={500} lineClamp={1}>{item.model}</Text>
                                                        <Text size="10px" c="dimmed">{item.brand}</Text>
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right' }}>
                                                        <Text size="xs" fw={700}>{item.newPrice.toLocaleString()}원</Text>
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right' }}>
                                                        <Text size="xs" fw={700} c="red">+{item.pct.toFixed(1)}%</Text>
                                                    </Table.Td>
                                                </Table.Tr>
                                            ))}
                                            {priceVolatility.gainers.length === 0 && (
                                                <Table.Tr><Table.Td colSpan={3} ta="center" py="xl" c="dimmed">변동 데이터 없음</Table.Td></Table.Tr>
                                            )}
                                        </Table.Tbody>
                                    </Table>
                                </Paper>
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, md: 6 }}>
                                <Paper withBorder p="md" radius="md">
                                    <Group mb="xs">
                                        <Badge color="blue" variant="filled" size="lg">TOP 10 가격 하락</Badge>
                                        <Text size="xs" c="dimmed">전일 대비 (기존 카테고리/필터 내)</Text>
                                    </Group>
                                    <Table verticalSpacing="xs" highlightOnHover striped withColumnBorders withTableBorder>
                                        <Table.Thead bg="blue.0">
                                            <Table.Tr>
                                                <Table.Th>제품명</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>최신 가격</Table.Th>
                                                <Table.Th style={{ textAlign: 'right' }}>변동률</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {priceVolatility.losers.map((item, i) => (
                                                <Table.Tr key={item.model}>
                                                    <Table.Td>
                                                        <Text size="xs" fw={500} lineClamp={1}>{item.model}</Text>
                                                        <Text size="10px" c="dimmed">{item.brand}</Text>
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right' }}>
                                                        <Text size="xs" fw={700}>{item.newPrice.toLocaleString()}원</Text>
                                                    </Table.Td>
                                                    <Table.Td style={{ textAlign: 'right' }}>
                                                        <Text size="xs" fw={700} c="blue">{item.pct.toFixed(1)}%</Text>
                                                    </Table.Td>
                                                </Table.Tr>
                                            ))}
                                            {priceVolatility.losers.length === 0 && (
                                                <Table.Tr><Table.Td colSpan={3} ta="center" py="xl" c="dimmed">변동 데이터 없음</Table.Td></Table.Tr>
                                            )}
                                        </Table.Tbody>
                                    </Table>
                                </Paper>
                            </Grid.Col>
                        </Grid>
                    </Tabs.Panel>

                    <Tabs.Panel value="brand">
                        <Group mb="lg" align="flex-end">
                            <Select
                                label="분석 카테고리" placeholder="Category" data={uniqueCategories} value={selCategory}
                                onChange={(v) => { setSelCategory(v); setSelBrand(null); setSelProducts([]); setSelChipsets([]); }} searchable
                            />
                            <MultiSelect
                                label="비교 브랜드 선택" placeholder="브랜드 선택..."
                                data={uniqueBrands} value={selAnalysisBrands} onChange={setSelAnalysisBrands}
                                searchable clearable w={300} maxValues={10}
                            />
                            {(selCategory === 'MB' || selCategory === 'VGA') && (
                                <MultiSelect
                                    label="칩셋(Spec) 필터" placeholder="B650, Z790, RTX4070..." data={uniqueChipsets} value={selChipsets} onChange={setSelChipsets}
                                    searchable clearable w={300}
                                />
                            )}
                        </Group>

                        <Grid gutter="xl">
                            <Grid.Col span={5}>
                                <Card withBorder p="sm" h="100%">
                                    <Text size="sm" fw={700} mb="sm" ta="center">브랜드별 평균 가격 (최신)</Text>
                                    <div style={{ height: 400, width: '100%' }}>
                                        <ResponsiveContainer>
                                            <BarChart data={brandAverageData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }} layout="horizontal">
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="brand" interval={0} fontSize={10} tick={{ dy: 5 }} />
                                                <YAxis tickFormatter={currencyFormatter} fontSize={11} width={40} />
                                                <Tooltip cursor={{ fill: 'transparent' }} content={<CustomTooltip />} />
                                                <Bar dataKey="avgPrice" name="평균 가격" radius={[4, 4, 0, 0]}>
                                                    {brandAverageData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={BRAND_COLORS[entry.brand] || PALETTE[index % PALETTE.length]} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </Card>
                            </Grid.Col>
                            <Grid.Col span={7}>
                                <Card withBorder p="sm" h="100%">
                                    <Text size="sm" fw={700} mb="sm" ta="center">브랜드별 가격 변동 추이</Text>
                                    {brandTrendSeries.length > 0 ? (
                                        <div style={{ height: 500, width: '100%' }}>
                                            <ResponsiveContainer>
                                                <LineChart data={brandTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis
                                                        dataKey="date"
                                                        tickFormatter={xAxisDateFormatter}
                                                        padding={{ left: 20, right: 20 }}
                                                    />
                                                    <YAxis domain={['auto', 'auto']} tickFormatter={currencyFormatter} width={40} />
                                                    <Tooltip content={<CustomTooltip />} />
                                                    <Legend verticalAlign="bottom" height={60} wrapperStyle={{ paddingTop: '20px' }} />
                                                    {brandTrendSeries.map((s) => (
                                                        <Line
                                                            key={s.name} type="monotone" dataKey={s.name} stroke={s.color}
                                                            strokeWidth={2} dot={false} activeDot={{ r: 5 }}
                                                            connectNulls={true} name={s.label}
                                                        />
                                                    ))}
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : <Text c="dimmed" ta="center" mt="xl">데이터 없음</Text>}
                                </Card>
                            </Grid.Col>
                        </Grid>
                    </Tabs.Panel>
                </Tabs>
            </Card>

            {/* Table Section */}
            <Card withBorder radius="md" p="md">
                <Group mb="sm" justify="space-between">
                    <Group>
                        <IconFileSpreadsheet size={20} />
                        <Text fw={700}>전체 제품 확인된 최신 가격 (Last Known Value)</Text>
                        {selCategory && <Badge color="blue">{selCategory}</Badge>}
                    </Group>
                </Group>
                <ScrollArea h={400}>
                    <Table stickyHeader highlightOnHover striped>
                        <Table.Thead bg="gray.1">
                            <Table.Tr><Table.Th>Brand</Table.Th><Table.Th>Model Name</Table.Th><Table.Th>Spec</Table.Th><Table.Th style={{ textAlign: 'right' }}>Price (Date)</Table.Th></Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {filteredTableData.length > 0 ? (
                                filteredTableData.slice(0, 50).map((item, idx) => (
                                    <Table.Tr key={idx}>
                                        <Table.Td>{item.brand}</Table.Td>
                                        <Table.Td fw={500}>{item.model}</Table.Td>
                                        <Table.Td>{item.spec || '-'}</Table.Td>
                                        <Table.Td style={{ textAlign: 'right' }}>
                                            <Text span fw={700} mr={6}>{item.price.toLocaleString()}원</Text>
                                            {item.date !== globalLatestDate && (
                                                <Text span size="xs" c="dimmed">({tableDateFormatter(item.date)})</Text>
                                            )}
                                        </Table.Td>
                                    </Table.Tr>
                                ))
                            ) : (<Table.Tr><Table.Td colSpan={4} align="center" py="xl" c="dimmed">표시할 데이터가 없습니다.</Table.Td></Table.Tr>)}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Card>
        </Container>
    );
}