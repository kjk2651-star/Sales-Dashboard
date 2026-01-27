"use client";

import { Title, Text, Paper, SimpleGrid } from "@mantine/core";

export default function DashboardHome() {
    return (
        <div>
            <Title order={2} mb="lg">대시보드 요약</Title>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <Paper withBorder p="md" radius="md">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        총 매출
                    </Text>
                    <Text fw={700} size="xl" mt="sm">
                        ₩ 0
                    </Text>
                </Paper>
                <Paper withBorder p="md" radius="md">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        판매 수량
                    </Text>
                    <Text fw={700} size="xl" mt="sm">
                        0 ea
                    </Text>
                </Paper>
                <Paper withBorder p="md" radius="md">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        목표 달성률
                    </Text>
                    <Text fw={700} size="xl" mt="sm">
                        0%
                    </Text>
                </Paper>
            </SimpleGrid>
        </div>
    );
}
