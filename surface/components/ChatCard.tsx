import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import { theme } from "../constants/theme";
import { MessageList } from "./MessageList";
import { GlassPill, GlassButton } from "./Glass";
import { HoverTray } from "./HoverTray";
import type { ChatMessage, ChatSession } from "../types/chat";

/** Compact waveform icon for card input */
function WaveformSmall() {
  const c = "rgba(0,0,0,0.25)";
  return (
    <View style={waveStyles.container}>
      <View style={[waveStyles.bar, { height: 5, backgroundColor: c }]} />
      <View style={[waveStyles.bar, { height: 11, backgroundColor: c }]} />
      <View style={[waveStyles.bar, { height: 8, backgroundColor: c }]} />
      <View style={[waveStyles.bar, { height: 13, backgroundColor: c }]} />
      <View style={[waveStyles.bar, { height: 6, backgroundColor: c }]} />
    </View>
  );
}

const waveStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1.5,
    height: 16,
  },
  bar: {
    width: 2,
    borderRadius: 1.5,
  },
});

interface ChatCardProps {
  session: ChatSession;
  focused?: boolean;
  style?: any;
  onDescend?: () => void;
  onResolve?: () => void;
  onRename?: (newName: string) => void;
  childCount?: number;
  resolvedCount?: number;
  /** Disable internal scroll so parent scroll works (e.g. in strips) */
  scrollEnabled?: boolean;
  /** Priority tint overrides status tint on the glass pill header */
  priorityTint?: string;
}

export function ChatCard({ session, focused = false, style, onDescend, onResolve, onRename, childCount = 0, resolvedCount = 0, scrollEnabled = true, priorityTint }: ChatCardProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(session.messages);
  const [text, setText] = useState("");
  const [inputHeight, setInputHeight] = useState(20);
  const cardRef = useRef<View>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(session.name);

  useEffect(() => { setEditText(session.name); }, [session.name]);

  // Route horizontal wheel events to the nearest horizontal scroll parent.
  // Necessary because nested scroll containers eat wheel events on web.
  useEffect(() => {
    if (Platform.OS !== "web" || !cardRef.current) return;
    const el = cardRef.current as unknown as HTMLElement;
    const handler = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX);
      const dy = Math.abs(e.deltaY);
      // Only intercept when scroll is meaningfully horizontal
      if (dx <= 3 || dy >= dx) return;
      // Walk up DOM to find first element that can actually scroll horizontally
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        if (parent.scrollWidth > parent.clientWidth + 1) {
          e.preventDefault();
          parent.scrollLeft += e.deltaX;
          return;
        }
        parent = parent.parentElement;
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { id: String(Date.now()), kind: "user", text: trimmed, timestamp: Date.now() },
    ]);
    setText("");
    setInputHeight(20);
  }, [text]);

  const handleKeyPress = (e: any) => {
    if (
      Platform.OS === "web" &&
      e.nativeEvent.key === "Enter" &&
      !e.nativeEvent.shiftKey
    ) {
      e.preventDefault();
      handleSend();
    }
  };

  const onContentSizeChange = useCallback((e: any) => {
    const h = e.nativeEvent.contentSize.height;
    setInputHeight(Math.min(Math.max(h, 20), 6 * 20));
  }, []);

  const hasText = text.trim().length > 0;

  return (
    <View ref={cardRef} style={[styles.container, focused ? styles.containerFocused : styles.containerUnfocused, session.status === "resolved" && { opacity: 0.45 }, !scrollEnabled && Platform.OS === "web" && { overscrollBehavior: "auto" } as any, style]}>
      <MessageList messages={messages} scrollEnabled={scrollEnabled} />

      {/* Floating header — overlays top of message list */}
      <View
        style={styles.headerOverlay}
      >
        {onDescend ? (
          <HoverTray actions={[{ label: 'Edit', onPress: () => setEditing(true) }]}>
            <Pressable onPress={onDescend} style={Platform.OS === "web" ? { cursor: "pointer" } as any : undefined}>
              <GlassPill height={44} tint={priorityTint ?? theme.status[session.status as keyof typeof theme.status]?.tint}>
                {editing ? (
                  <TextInput
                    autoFocus
                    value={editText}
                    onChangeText={setEditText}
                    onSubmitEditing={() => { onRename?.(editText); setEditing(false); }}
                    onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") { setEditText(session.name); setEditing(false); } }}
                    onBlur={() => { onRename?.(editText); setEditing(false); }}
                    style={styles.titleInput}
                  />
                ) : (
                  <Text style={styles.title} numberOfLines={1}>
                    {session.name}
                  </Text>
                )}
              </GlassPill>
            </Pressable>
          </HoverTray>
        ) : (
          <HoverTray actions={[{ label: 'Edit', onPress: () => setEditing(true) }]}>
            <GlassPill tint={priorityTint ?? theme.status[session.status as keyof typeof theme.status]?.tint}>
              {editing ? (
                <TextInput
                  autoFocus
                  value={editText}
                  onChangeText={setEditText}
                  onSubmitEditing={() => { onRename?.(editText); setEditing(false); }}
                  onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") { setEditText(session.name); setEditing(false); } }}
                  onBlur={() => { onRename?.(editText); setEditing(false); }}
                  style={styles.titleInput}
                />
              ) : (
                <Text style={styles.title} numberOfLines={1}>
                  {session.name}
                </Text>
              )}
            </GlassPill>
          </HoverTray>
        )}
        {childCount > 0 && (
          <GlassButton size={36} onPress={onDescend} tint={priorityTint ?? theme.status[session.status as keyof typeof theme.status]?.tint}>
            <Text style={styles.childCount}>{childCount}</Text>
          </GlassButton>
        )}
        <View style={{ flex: 1 }} />
        <GlassButton size={32} onPress={onResolve}>
          <Text style={styles.checkIcon}>{"\u2713"}</Text>
        </GlassButton>
      </View>

      {/* Card input bar */}
      {session.status !== "resolved" && <View style={styles.inputArea}>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { height: inputHeight }]}
            value={text}
            onChangeText={setText}
            placeholder="Message..."
            placeholderTextColor="rgba(0,0,0,0.22)"
            multiline
            onContentSizeChange={onContentSizeChange}
            onKeyPress={handleKeyPress}
            // @ts-ignore web-only
            enterKeyHint="send"
          />
          {hasText ? (
            <Pressable onPress={handleSend} style={({ pressed }) => [styles.inputBtn, styles.sendBtn, pressed && styles.btnPressed]}>
              <Text style={styles.sendArrow}>{"\u2191"}</Text>
            </Pressable>
          ) : (
            <Pressable style={({ pressed }) => [styles.inputBtn, pressed && styles.btnPressed]}>
              <WaveformSmall />
            </Pressable>
          )}
        </View>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    overflow: "hidden",
    ...(Platform.OS === "web"
      ? {
          flex: "1 1 400px",
          minWidth: 320,
          maxWidth: 560,
          height: "calc(100vh - 160px)",
          maxHeight: 760,
          display: "flex",
          flexDirection: "column",
          overscrollBehavior: "contain",
        }
      : {
          flex: 1,
        }),
  } as any,
  containerFocused: {} as any,
  containerUnfocused: {} as any,
  headerOverlay: {
    ...(Platform.OS === "web"
      ? { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }
      : { position: "absolute", top: 0, left: 0, right: 0 }),
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    gap: 8,
  } as any,
  title: {
    ...theme.typography.cardTitle,
    flexShrink: 1,
  },
  depthIndicator: {
    ...theme.typography.cardDepthIndicator,
    marginLeft: 4,
  },
  childCount: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "rgba(0,0,0,0.70)",
    fontFamily: theme.fonts.sans,
  },
  checkIcon: {
    ...theme.typography.cardCheckIcon,
  },
  titleInput: {
    ...theme.typography.cardTitleInput,
    flexShrink: 1,
    minWidth: 80,
    ...(Platform.OS === "web" ? { outlineStyle: "none", fontFamily: theme.fonts.sans, lineHeight: "normal", padding: 0, margin: 0 } : {}),
  } as any,
  editLabel: {
    ...theme.typography.cardEditLabel,
  },
  // Card input bar — floating overlay at bottom
  inputArea: {
    ...(Platform.OS === "web"
      ? { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10 }
      : { position: "absolute", bottom: 0, left: 0, right: 0 }),
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  } as any,
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F5F3F0",
    borderRadius: 12,
    paddingLeft: 16,
    paddingRight: 5,
    paddingVertical: 5,
    minHeight: 48,
  },
  input: {
    ...theme.typography.cardInput,
    flex: 1,
    paddingVertical: 6,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  inputBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    backgroundColor: "rgba(0,0,0,0.10)",
  },
  sendArrow: {
    ...theme.typography.cardSendArrow,
  },
  btnPressed: {
    opacity: 0.5,
  },
});
