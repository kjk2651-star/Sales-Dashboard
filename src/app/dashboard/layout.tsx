"use client";

import { AppShell, Burger, Group, Text, NavLink, Box } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
    IconHome,
    IconChartBar,
    IconScale,
    IconLogout
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const data = [
    { link: "/dashboard", label: "홈", icon: IconHome },
    { link: "/dashboard/market-price", label: "시장 가격 비교", icon: IconScale },
    { link: "/dashboard/run-rate", label: "재고 및 판매분석(ASUS)", icon: IconChartBar },
    { link: "/dashboard/run-rate-others", label: "재고 및 판매분석(MANI&ASRock)", icon: IconChartBar },
];

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [opened, { toggle }] = useDisclosure();
    const pathname = usePathname();
    const router = useRouter();

    const handleLogout = async () => {
        // No auth.signOut() needed
        router.push("/");
    };

    const links = data.map((item) => (
        <NavLink
            key={item.label}
            component={Link}
            href={item.link}
            active={pathname === item.link}
            label={item.label}
            leftSection={<item.icon size={16} stroke={1.5} />}
            onClick={() => {
                if (opened) toggle();
            }}
        />
    ));

    return (
        <AppShell
            header={{ height: 60 }}
            navbar={{
                width: 300,
                breakpoint: "sm",
                collapsed: { mobile: !opened },
            }}
            padding="md"
        >
            <AppShell.Header>
                <Group h="100%" px="md">
                    <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
                    <Group justify="space-between" style={{ flex: 1 }}>
                        <Text fw={700} c="blue" size="xl">Sales Dashboard</Text>
                        <Text size="sm" c="dimmed" visibleFrom="sm">Admin</Text>
                    </Group>
                </Group>
            </AppShell.Header>

            <AppShell.Navbar p="md">
                <Box style={{ flex: 1 }}>
                    <Text size="xs" fw={500} c="dimmed" mb="sm">MENU</Text>
                    {links}
                </Box>

                <Box pt="md" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
                    <NavLink
                        label="로그아웃 (Home)"
                        leftSection={<IconLogout size={16} stroke={1.5} />}
                        onClick={handleLogout}
                        color="red"
                        variant="subtle"
                        active
                    />
                </Box>
            </AppShell.Navbar>

            <AppShell.Main>
                {children}
            </AppShell.Main>
        </AppShell>
    );
}
