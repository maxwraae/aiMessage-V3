import { View, Text, StyleSheet } from "react-native";
import { theme } from "../constants/theme";
import type { UserMessage as UserMessageType } from "../types/chat";

interface UserMessageProps {
  message: UserMessageType;
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <View style={styles.pill}>
      <Text style={styles.text}>{message.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginVertical: 6,
  },
  text: {
    ...theme.typography.userMessage,
  },
});
