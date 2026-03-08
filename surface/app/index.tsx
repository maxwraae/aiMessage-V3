import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Platform, Animated, ScrollView, Dimensions } from "react-native";
import { ChatCard } from "../components/ChatCard";
import { GlassButton, GlassPill } from "../components/Glass";
import { NeedsYouStrip } from "../components/NeedsYouStrip";
import type { NeedsYouItem } from "../components/NeedsYouStrip";
import { RecentWorkStrip } from "../components/RecentWorkStrip";
import type { ObjectiveCardData } from "../components/ObjectiveCard";
import { mockSession } from "../constants/mockData";
import { theme } from "../constants/theme";

// Time-of-day gradient: each period has a top and base color.
// A subtle CSS breathing animation drifts lightness within the period.
const TOD_PERIODS = {
  morning:   { top: [25, 30, 89],  base: [30, 8, 93]  },  // 6-10  sunrise coral
  midday:    { top: [200, 12, 91], base: [30, 6, 94]  },  // 10-15 warm neutral
  afternoon: { top: [36, 26, 88],  base: [32, 8, 93]  },  // 15-19 golden amber
  evening:   { top: [20, 22, 87],  base: [28, 8, 92]  },  // 19-22 ember
  night:     { top: [220, 12, 87], base: [30, 5, 92]  },  // 22-6  warm slate
} as const;

type TodPeriod = keyof typeof TOD_PERIODS;

function getTimePeriod(h: number): TodPeriod {
  if (h >= 6 && h < 10) return "morning";
  if (h >= 10 && h < 15) return "midday";
  if (h >= 15 && h < 19) return "afternoon";
  if (h >= 19 && h < 22) return "evening";
  return "night";
}

const BREATHE_CSS = `
@keyframes todBreathe {
  0%, 100% { filter: brightness(1.00); }
  50%      { filter: brightness(1.015); }
}`;

function useTimeOfDay() {
  const [period, setPeriod] = useState<TodPeriod>(() => getTimePeriod(new Date().getHours()));

  useEffect(() => {
    if (Platform.OS !== "web") return;
    // Inject breathing animation
    const styleEl = document.createElement("style");
    styleEl.textContent = BREATHE_CSS;
    document.head.appendChild(styleEl);
    // Check period every minute
    const t = setInterval(() => {
      setPeriod(getTimePeriod(new Date().getHours()));
    }, 60_000);
    return () => { clearInterval(t); document.head.removeChild(styleEl); };
  }, []);

  const colors = TOD_PERIODS[period];
  const gradient = `radial-gradient(ellipse at 50% -20%, hsl(${colors.top[0]},${colors.top[1]}%,${colors.top[2]}%) 0%, hsl(${colors.base[0]},${colors.base[1]}%,${colors.base[2]}%) 75%)`;
  // Text color: same hue as background top, stronger saturation, darker
  const textColor = `hsl(${colors.top[0]}, ${Math.min(colors.top[1] + 12, 40)}%, 45%)`;
  const textColorMuted = `hsl(${colors.top[0]}, ${Math.min(colors.top[1] + 8, 30)}%, 58%)`;

  return { gradient, period, textColor, textColorMuted };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const h = now.getHours();
  const m = now.getMinutes().toString().padStart(2, "0");
  const time = `${h}:${m}`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
  return { time, date };
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => Dimensions.get("window").width < theme.layout.mobileBreakpoint);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const mq = window.matchMedia(`(max-width: ${theme.layout.mobileBreakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    setMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return mobile;
}

interface ObjectiveNode {
  name: string;
  status: "idle" | "thinking" | "needs-input" | "resolved" | "failed";
  description?: string;
  children?: ObjectiveNode[];
}

const initialTree: ObjectiveNode = {
  name: "Ship the app",
  status: "idle",
  description: "Get the product out the door. Working app, deployed, usable by real people. Everything else serves this.",
  children: [
    {
      name: "Nail onboarding",
      status: "idle",
      description: "First 60 seconds determine whether someone stays or leaves. Make those seconds count. Zero confusion, immediate value.",
      children: [
        {
          name: "Simplify goals",
          status: "needs-input",
          description: "Strip the goal-setting flow down to its essence. Users should be able to set a meaningful goal in under 30 seconds without feeling like they're filling out a form.",
          children: [
            // GRAY  — idle: quiet, not doing anything
            { name: "Write API docs", status: "idle" },
            // AMBER — thinking: working, do not interrupt
            { name: "Refactor auth", status: "thinking" },
            // BLUE  — needs-input: wants your attention, waiting for you
            { name: "Fix error handling", status: "needs-input" },
            // RED   — failed: something broke, needs investigation
            { name: "Design landing page", status: "failed" },
          ],
        },
        { name: "Build tutorial flow", status: "idle", description: "Walk new users through core features without making them read documentation." },
        { name: "Test with 5 users", status: "idle", description: "Get real humans through the flow. Watch where they hesitate, where they get lost." },
      ],
    },
    { name: "Set up CI/CD", status: "idle", description: "Automated builds, tests, and deploys. Push to main and it ships." },
    { name: "Performance audit", status: "thinking", description: "Find and fix the slow spots. Target sub-second load times on mobile." },
  ],
};

function findByName(root: ObjectiveNode, name: string): ObjectiveNode | null {
  if (root.name === name) return root;
  for (const child of root.children ?? []) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return null;
}

function findPath(node: ObjectiveNode, targetName: string, path: ObjectiveNode[] = []): ObjectiveNode[] | null {
  if (node.name === targetName) return [...path, node];
  if (node.children) {
    for (const child of node.children) {
      const result = findPath(child, targetName, [...path, node]);
      if (result) return result;
    }
  }
  return null;
}

// Mock data for the "Needs You" strip
const mockNeedsYou: NeedsYouItem[] = [
  {
    session: {
      ...mockSession,
      id: "needs-1",
      name: "Fix error handling",
      status: "needs-input",
    },
    urgent: true,
    important: true,
    parents: ["Ship the app", "Nail onboarding"],
  },
  {
    session: {
      ...mockSession,
      id: "needs-2",
      name: "Review auth refactor",
      status: "needs-input",
    },
    urgent: true,
    parents: ["Ship the app", "Set up CI/CD"],
  },
  {
    session: {
      ...mockSession,
      id: "needs-3",
      name: "Approve deployment config",
      status: "needs-input",
    },
    important: true,
    parents: ["Ship the app"],
  },
];

// Mock data for the "Recent work" strip
const mockRecentWork: ObjectiveCardData[] = [
  {
    id: "rw-1",
    name: "Ship the app",
    description: "Get the product out the door. Working app, deployed, usable by real people.",
    lastAccessed: new Date("2026-03-07T18:00:00"),
    status: "thinking" as const,
    children: [
      { name: "Nail onboarding", status: "idle" as const },
      { name: "Set up CI/CD", status: "idle" as const },
      { name: "Performance audit", status: "thinking" as const },
    ],
  },
  {
    id: "rw-2",
    name: "Harvard application",
    description: "Complete and submit the graduate school application. Essays, recommendations, portfolio.",
    lastAccessed: new Date("2026-03-06T14:00:00"),
    status: "needs-input" as const,
    children: [
      { name: "Personal statement draft", status: "needs-input" as const },
      { name: "Get recommendation letters", status: "idle" as const },
      { name: "Prepare portfolio", status: "thinking" as const },
      { name: "Application fee", status: "idle" as const },
    ],
  },
  {
    id: "rw-3",
    name: "Bactolife paper",
    description: "Finalize the manuscript for the active fiber ETEC study. Figures, methods, submission.",
    lastAccessed: new Date("2026-03-04T09:00:00"),
    status: "idle" as const,
    children: [
      { name: "Revise discussion", status: "idle" as const },
      { name: "Figure 3 redraw", status: "idle" as const },
    ],
  },
];

export default function HomeScreen() {
  const isMobile = useIsMobile();
  const tod = useTimeOfDay();
  const clock = useClock();
  const [view, setView] = useState<"home" | "work" | "needs-you">("home");
  const [tree, setTree] = useState<ObjectiveNode>(() => JSON.parse(JSON.stringify(initialTree)));
  const [currentName, setCurrentName] = useState("Simplify goals");

  const current = findByName(tree, currentName) ?? tree;

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const gridScrollRef = useRef<ScrollView>(null);

  // ── Objective inline editing ──
  const [objectiveEditing, setObjectiveEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [descHeight, setDescHeight] = useState(40);
  const descInputRef = useRef<TextInput>(null);
  const objectiveSectionRef = useRef<View>(null);

  const startObjectiveEdit = useCallback(() => {
    setEditTitle(current.name);
    setEditDescription(current.description ?? "");
    setObjectiveEditing(true);
  }, [current.name, current.description]);

  const commitObjectiveEdit = useCallback(() => {
    if (!objectiveEditing) return;
    const newTitle = editTitle.trim() || current.name;
    const newDesc = editDescription.trim();
    setObjectiveEditing(false);
    if (newTitle !== current.name || newDesc !== (current.description ?? "")) {
      const oldName = current.name;
      mutateTree(draft => {
        const node = findByName(draft, oldName);
        if (node) {
          node.name = newTitle;
          node.description = newDesc || undefined;
        }
      });
      if (newTitle !== oldName) setCurrentName(newTitle);
    }
  }, [objectiveEditing, editTitle, editDescription, current.name, current.description]);

  const cancelObjectiveEdit = useCallback(() => {
    setObjectiveEditing(false);
  }, []);

  // Click-outside detection for objective edit
  useEffect(() => {
    if (Platform.OS !== "web" || !objectiveEditing) return;
    const handler = (e: MouseEvent) => {
      const el = (objectiveSectionRef.current as unknown as HTMLElement);
      if (el && !el.contains(e.target as Node)) {
        commitObjectiveEdit();
      }
    };
    // Delay to avoid immediate trigger from the pen click
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", handler); };
  }, [objectiveEditing, commitObjectiveEdit]);

  // Horizontal trackpad/wheel scrolls the grid vertically
  useEffect(() => {
    if (Platform.OS !== "web" || !gridScrollRef.current) return;
    const el = (gridScrollRef.current as unknown as { getScrollableNode?: () => HTMLElement })?.getScrollableNode?.()
      ?? (gridScrollRef.current as unknown as HTMLElement);
    if (!el || !el.addEventListener) return;
    const handler = (e: WheelEvent) => {
      // If the event is mostly horizontal, convert to vertical scroll
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 3) {
        e.preventDefault();
        el.scrollTop += e.deltaX;
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ── Tree mutation helpers ──
  function mutateTree(updater: (draft: ObjectiveNode) => void): void {
    setTree(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as ObjectiveNode;
      updater(next);
      return next;
    });
  }

  const addChild = useCallback((name: string) => {
    mutateTree(draft => {
      const parent = findByName(draft, currentName);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push({ name, status: "idle", children: [] });
      }
    });
  }, [currentName]);

  const resolveNode = useCallback((nodeName: string) => {
    mutateTree(draft => {
      const node = findByName(draft, nodeName);
      if (node) {
        function resolve(n: ObjectiveNode) {
          n.status = "resolved";
          for (const child of n.children ?? []) resolve(child);
        }
        resolve(node);
      }
    });
  }, []);

  const handleAddChild = useCallback(() => {
    if (Platform.OS === "web") {
      const name = window.prompt("New objective name");
      if (name?.trim()) addChild(name.trim());
    }
  }, [addChild]);

  const renameNode = useCallback((oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    mutateTree(draft => {
      const node = findByName(draft, oldName);
      if (node) node.name = newName.trim();
    });
    if (oldName === currentName) setCurrentName(newName.trim());
  }, [currentName]);

  const navigateTo = useCallback((node: ObjectiveNode, direction: "up" | "down" = "down") => {
    const exitY = direction === "up" ? 40 : -40;
    const enterY = direction === "up" ? -40 : 40;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: exitY, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setCurrentName(node.name);
      slideAnim.setValue(enterY);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    });
  }, [fadeAnim, slideAnim]);

  const [heroText, setHeroText] = useState("");

  const enterWorkView = useCallback((nodeName: string) => {
    setCurrentName(nodeName);
    slideAnim.setValue(-40);
    fadeAnim.setValue(0);
    setView("work");
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleHeroSubmit = useCallback(() => {
    const trimmed = heroText.trim();
    if (!trimmed) return;
    // Create a new child at the root and navigate into it
    mutateTree(draft => {
      if (!draft.children) draft.children = [];
      draft.children.unshift({ name: trimmed, status: "idle", children: [] });
    });
    setHeroText("");
    enterWorkView(trimmed);
  }, [heroText, enterWorkView]);

  const path = findPath(tree, currentName) || [current];
  const ancestors = path.slice(0, -1);
  const children = current.children || [];

  const goHome = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 40, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setView("home");
      slideAnim.setValue(0);
      fadeAnim.setValue(1);
    });
  }, [fadeAnim, slideAnim]);

  const enterNeedsYou = useCallback(() => {
    slideAnim.setValue(-40);
    fadeAnim.setValue(0);
    setView("needs-you");
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const goUp = useCallback(() => {
    if (ancestors.length > 0) navigateTo(ancestors[ancestors.length - 1], "up");
  }, [ancestors, navigateTo]);

  const goDown = useCallback((child: ObjectiveNode) => {
    navigateTo(child, "down");
  }, [navigateTo]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowUp") { e.preventDefault(); if (ancestors.length > 0) navigateTo(ancestors[ancestors.length - 1], "up"); }
      if (e.key === "ArrowDown") { e.preventDefault(); const d = children.find((c) => c.children && c.children.length > 0); if (d) navigateTo(d, "down"); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [ancestors, children, navigateTo]);

  // Build collapsed breadcrumb: ancestors only (current node shown in objective section below)
  const maxCrumbs = isMobile ? 2 : 3;
  const displayPath: { node: ObjectiveNode; isEllipsis?: boolean }[] = [];
  if (ancestors.length <= maxCrumbs) {
    ancestors.forEach((n) => displayPath.push({ node: n }));
  } else {
    displayPath.push({ node: ancestors[0] }); // root
    displayPath.push({ node: ancestors[0], isEllipsis: true }); // ...
    const tail = ancestors.slice(-(maxCrumbs - 1));
    tail.forEach((n) => displayPath.push({ node: n }));
  }

  // ── HOME VIEW ──
  if (view === "home") {
    return (
      <View style={[styles.root, Platform.OS === "web" ? { background: tod.gradient, transition: "background 2s ease", animation: "todBreathe 8s ease-in-out infinite" } as any : null]}>
        {/* Header — home pill left, clock right */}
        <View style={styles.header}>
          <View style={styles.headerInner}>
            <GlassPill height={36}>
              <Text style={styles.homeIcon}>{"\u2302"}</Text>
            </GlassPill>
            <View style={styles.clockGroup}>
              <Text style={styles.clockTime}>{clock.time}</Text>
              <Text style={styles.clockDate}>{clock.date}</Text>
            </View>
          </View>
        </View>

        {/* Scrollable home content */}
        <ScrollView
          style={styles.homeScroll}
          contentContainerStyle={styles.homeScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero — input at center */}
          <View style={styles.heroContainer}>
            <View style={styles.heroInner}>
              <Text style={[styles.heroGreeting, { color: tod.textColor }]}>What are you working on?</Text>
              <View style={styles.heroInputWrapper}>
                <TextInput
                  style={styles.heroInput}
                  value={heroText}
                  onChangeText={setHeroText}
                  placeholder="Start something new..."
                  placeholderTextColor="rgba(0,0,0,0.22)"
                  onKeyPress={(e: any) => {
                    if (Platform.OS === "web" && e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
                      e.preventDefault();
                      handleHeroSubmit();
                    }
                  }}
                  // @ts-ignore web-only
                  enterKeyHint="send"
                />
                {heroText.trim().length > 0 ? (
                  <Pressable onPress={handleHeroSubmit} style={({ pressed }) => [styles.heroSendBtn, pressed && { opacity: 0.5 }]}>
                    <Text style={styles.heroSendArrow}>{"\u2191"}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.heroWaveform}>
                    {[5, 11, 8, 13, 6].map((h, i) => (
                      <View key={i} style={{ width: 2, height: h, borderRadius: 1.5, backgroundColor: "rgba(0,0,0,0.25)" }} />
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Needs You strip */}
          <NeedsYouStrip items={mockNeedsYou} onNavigate={(id) => enterWorkView(id)} onExpand={enterNeedsYou} headerColor={tod.textColor} />

          {/* Recent Work strip */}
          <RecentWorkStrip items={mockRecentWork} onNavigate={(id) => enterWorkView(id)} headerColor={tod.textColor} />
        </ScrollView>
      </View>
    );
  }

  // ── NEEDS YOU VIEW ──
  if (view === "needs-you") {
    return (
      <View style={[styles.root, Platform.OS === "web" ? { background: tod.gradient, transition: "background 2s ease", animation: "todBreathe 8s ease-in-out infinite" } as any : null]}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerInner}>
            <View style={styles.breadcrumbRow}>
              <Pressable onPress={goHome} style={Platform.OS === "web" ? { cursor: "pointer" } as any : undefined}>
                <GlassPill height={36} tint="rgba(255,255,255,0.5)">
                  <Text style={styles.homeIcon}>{"\u2302"}</Text>
                </GlassPill>
              </Pressable>
              <Text style={styles.breadcrumbSep}>{"\u203A"}</Text>
              <GlassPill height={30}>
                <Text style={styles.breadcrumbCurrent}>Needs you</Text>
              </GlassPill>
            </View>
            <View style={styles.clockGroup}>
              <Text style={styles.clockTime}>{clock.time}</Text>
              <Text style={styles.clockDate}>{clock.date}</Text>
            </View>
          </View>
        </View>

        {/* Card grid — all needs-you sessions */}
        <Animated.View style={[styles.contentOuter, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.content}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.gridContent}>
              {mockNeedsYou.map((item, i) => (
                <ChatCard
                  key={item.session.id}
                  session={item.session}
                  focused={i === 0}
                  onResolve={() => {}}
                />
              ))}
            </View>
          </ScrollView>
        </Animated.View>

      </View>
    );
  }

  // ── WORK VIEW ──
  return (
    <View style={[styles.root, Platform.OS === "web" ? { background: tod.gradient, transition: "background 2s ease", animation: "todBreathe 8s ease-in-out infinite" } as any : null]}>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <View style={styles.breadcrumbRow}>
            {/* Ancestors: home + path, no separators, faded, close together */}
            <Pressable onPress={goHome} style={Platform.OS === "web" ? { cursor: "pointer" } as any : undefined}>
              <GlassPill height={36} tint="rgba(255,255,255,0.5)">
                <Text style={styles.homeIcon}>{"\u2302"}</Text>
              </GlassPill>
            </Pressable>
            {displayPath.map((entry, i) => {
              if (entry.isEllipsis) {
                return (
                  <Text key="ellipsis" style={styles.breadcrumbAncestor}>...</Text>
                );
              }
              return (
                <Pressable key={entry.node.name + i} onPress={() => navigateTo(entry.node, "up")} style={Platform.OS === "web" ? { cursor: "pointer" } as any : undefined}>
                  <GlassPill height={30} tint="rgba(255,255,255,0.5)">
                    <Text style={styles.breadcrumbAncestor}>{entry.node.name}</Text>
                  </GlassPill>
                </Pressable>
              );
            })}
            {/* Single separator before current */}
            <Text style={styles.breadcrumbSep}>{"\u203A"}</Text>
            <GlassPill height={30}>
              <Text style={styles.breadcrumbCurrent}>{current.name}</Text>
            </GlassPill>
          </View>
          <View style={styles.clockGroup}>
            <Text style={styles.clockTime}>{clock.time}</Text>
            <Text style={styles.clockDate}>{clock.date}</Text>
          </View>
        </View>
      </View>

      {/* ── CONTENT ── */}
      <Animated.View
        style={[styles.contentOuter, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
      >
        <ScrollView
          ref={gridScrollRef}
          showsVerticalScrollIndicator={false}
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Objective section — title, description, buttons stacked vertically */}
          <View style={styles.objectiveSection} ref={objectiveSectionRef}>
            {objectiveEditing ? (
              <TextInput
                autoFocus
                value={editTitle}
                onChangeText={setEditTitle}
                multiline
                onKeyPress={(e: any) => {
                  if (e.nativeEvent.key === "Escape") cancelObjectiveEdit();
                  if (e.nativeEvent.key === "Enter") { e.preventDefault(); commitObjectiveEdit(); }
                }}
                style={[styles.objectiveTitle, Platform.OS === "web" ? {
                  outlineStyle: "none",
                  padding: 0,
                  margin: 0,
                  border: "none",
                  background: "transparent",
                } : null] as any}
              />
            ) : (
              <Text style={styles.objectiveTitle}>{current.name}</Text>
            )}

            {objectiveEditing ? (
              <TextInput
                ref={descInputRef}
                value={editDescription}
                onChangeText={setEditDescription}
                onContentSizeChange={(e: any) => {
                  setDescHeight(Math.max(40, e.nativeEvent.contentSize.height));
                }}
                onKeyPress={(e: any) => {
                  if (e.nativeEvent.key === "Escape") cancelObjectiveEdit();
                  if (e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
                    e.preventDefault();
                    commitObjectiveEdit();
                  }
                }}
                multiline
                placeholder="Add a description..."
                placeholderTextColor="rgba(0,0,0,0.25)"
                style={[styles.objectiveDescription, { maxWidth: 640 }, Platform.OS === "web" ? {
                  outlineStyle: "none",
                  padding: 0,
                  margin: 0,
                  border: "none",
                  background: "transparent",
                  height: descHeight,
                } : null] as any}
              />
            ) : (
              <Text style={[styles.objectiveDescription, { maxWidth: 640 }]}>
                {current.description || "No description"}
              </Text>
            )}

            <View style={styles.actionButtons}>
              <GlassButton size={38} onPress={() => resolveNode(currentName)}>
                <Text style={styles.actionButtonIcon}>{"\u2713"}</Text>
              </GlassButton>
              <GlassButton size={38} onPress={startObjectiveEdit}>
                <Text style={styles.actionButtonIcon}>{"\u270E"}</Text>
              </GlassButton>
              <GlassButton size={38} onPress={handleAddChild}>
                <Text style={styles.plusIcon}>+</Text>
              </GlassButton>
            </View>
          </View>

          {/* Card grid */}
          <View style={styles.gridContent}>
            {children.map((child, i) => (
              <ChatCard
                key={child.name}
                session={{
                  ...mockSession,
                  id: child.name,
                  name: child.name,
                  status: child.status,
                }}
                focused={i === 0}
                onDescend={child.children && child.children.length > 0 ? () => goDown(child) : undefined}
                childCount={child.children?.length ?? 0}
                resolvedCount={child.children?.filter(c => c.status === "resolved").length ?? 0}
                onResolve={() => resolveNode(child.name)}
                onRename={(newName) => renameNode(child.name, newName)}
              />
            ))}
          </View>
        </ScrollView>
      </Animated.View>

    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    ...(Platform.OS === "web"
      ? { backgroundColor: theme.colors.background, minHeight: "100vh", overflow: "hidden" }
      : { backgroundColor: theme.colors.background }),
  } as any,

  // ── Header ──
  header: {
    ...(Platform.OS === "web"
      ? {
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          height: theme.layout.headerH,
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          backgroundColor: "rgba(237,235,232,0.80)",
        }
      : { position: "absolute", top: 0, left: 0, right: 0, height: theme.layout.headerH, backgroundColor: "#F0F0F0" }),
    alignItems: "center",
  } as any,
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
    maxWidth: theme.layout.gridMaxWidth,
    width: "100%",
    paddingHorizontal: theme.layout.gridPadding,
    height: "100%",
  } as any,
  breadcrumbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  homeIcon: {
    fontSize: 20,
    fontWeight: "400" as const,
    color: "rgba(40,35,30,0.50)",
    fontFamily: theme.fonts.sans,
  },
  breadcrumbAncestor: {
    ...theme.typography.breadcrumbAncestor,
  },
  breadcrumbCurrent: {
    ...theme.typography.breadcrumbCurrent,
  },
  breadcrumbSep: {
    fontSize: 28,
    fontWeight: "200" as const,
    color: "rgba(40,35,30,0.20)",
    fontFamily: theme.fonts.sans,
    marginHorizontal: 8,
  },
  plusIcon: {
    ...theme.typography.plusIcon,
  },
  // ── Clock ──
  clockGroup: {
    alignItems: "flex-end",
    gap: 1,
  },
  clockTime: {
    fontSize: 18,
    fontWeight: "500" as const,
    color: "rgba(22,18,14,0.50)",
    fontFamily: theme.fonts.sans,
    letterSpacing: 0.5,
  },
  clockDate: {
    fontSize: 13,
    fontWeight: "400" as const,
    color: "rgba(22,18,14,0.32)",
    fontFamily: theme.fonts.sans,
  },

  // ── Home scroll ──
  homeScroll: {
    flex: 1,
    ...(Platform.OS === "web" ? { overscrollBehavior: "none" } : {}),
  } as any,
  homeScrollContent: {
    paddingTop: theme.layout.headerH,
    paddingBottom: 64,
  },

  // ── Home hero ──
  heroContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    ...(Platform.OS === "web"
      ? { minHeight: `calc(100vh - ${theme.layout.headerH}px - 100px)` }
      : {}),
  } as any,
  heroInner: {
    alignItems: "center",
    width: "100%",
    maxWidth: 520,
    gap: 24,
  } as any,
  heroGreeting: {
    fontSize: 34,
    fontWeight: "700" as const,
    color: "rgba(22,18,14,0.65)",
    fontFamily: theme.fonts.sans,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  heroInputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    width: "100%",
    backgroundColor: "#F5F3F0",
    borderRadius: 14,
    paddingLeft: 18,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
    gap: 8,
  } as any,
  heroInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 22,
    color: "#000000",
    fontFamily: theme.fonts.sans,
    paddingVertical: 8,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  heroSendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroSendArrow: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700" as const,
    lineHeight: 18,
    fontFamily: theme.fonts.sans,
  },
  heroWaveform: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 38,
    paddingHorizontal: 10,
  },

  // ── Content (cards) ──
  contentOuter: {
    ...(Platform.OS === "web"
      ? { position: "fixed", top: 0, bottom: 0, left: 0, right: 0, zIndex: 25 }
      : { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }),
  } as any,
  content: {
    flex: 1,
    ...(Platform.OS === "web" ? { overscrollBehaviorX: "none" } : {}),
  } as any,
  scrollContent: {
    paddingTop: theme.layout.headerH + 48,
    maxWidth: theme.layout.gridMaxWidth,
    ...(Platform.OS === "web"
      ? { marginLeft: "auto", marginRight: "auto" }
      : {}),
  } as any,

  // ── Objective section ──
  objectiveSection: {
    paddingHorizontal: theme.layout.gridPadding,
    paddingTop: 24,
    paddingBottom: 72,
    gap: 16,
    ...(Platform.OS === "web"
      ? { maxWidth: "50%" }
      : {}),
    minWidth: 320,
  } as any,
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  actionButtonIcon: {
    fontSize: 17,
    fontWeight: "500" as const,
    color: "rgba(0,0,0,0.40)",
    fontFamily: theme.fonts.sans,
  },
  objectiveTitle: {
    fontSize: 38,
    fontWeight: "700" as const,
    color: "rgba(22,18,14,0.78)",
    fontFamily: theme.fonts.sans,
    letterSpacing: -0.5,
  },
  objectiveDescription: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: "rgba(22,18,14,0.65)",
    fontFamily: theme.fonts.sans,
  },

  // ── Card grid ──
  gridContent: {
    ...(Platform.OS === "web"
      ? {
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "flex-start",
          gap: theme.layout.gridGap,
          paddingHorizontal: theme.layout.gridPadding,
          paddingBottom: theme.layout.gridPadding,
        }
      : {
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "flex-start",
          gap: theme.layout.gridGap,
          paddingHorizontal: theme.layout.gridPadding,
          paddingBottom: theme.layout.gridPadding,
        }),
  } as any,

});
