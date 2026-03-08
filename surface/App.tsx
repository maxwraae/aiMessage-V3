import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { ChatCard } from "./components/ChatCard";
import { mockSession } from "./constants/mockData";
import { theme } from "./constants/theme";

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ChatCard session={mockSession} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
});
