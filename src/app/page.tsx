"use client";

import { Button, Container, Paper, Title, Text, Stack } from "@mantine/core";
import { useRouter } from "next/navigation";
import { IconChartBar } from "@tabler/icons-react";

export default function LandingPage() {
  const router = useRouter();

  const handleEnter = () => {
    router.push('/dashboard/run-rate');
  };

  return (
    <Container size="xs" h="100vh" style={{ display: 'flex', alignItems: 'center' }}>
      <Paper shadow="md" p="xl" radius="md" withBorder w="100%">
        <Stack align="center" gap="lg">
          <Title order={2} ta="center">Sales Dashboard</Title>
          <Text c="dimmed" size="sm" ta="center">
            실시간 판매 현황 및 재고 분석
          </Text>

          <Button
            fullWidth
            size="lg"
            onClick={handleEnter}
            leftSection={<IconChartBar size={20} />}
          >
            대시보드 입장하기
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
