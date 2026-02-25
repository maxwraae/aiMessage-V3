# iOS Native Stack: Architectural Flow Specification (Refined)

This document provides the definitive technical specification for the **aiMessage Mobile** experience. It defines a high-fidelity hierarchical navigation system optimized for one-handed use.

---

## **Technical Foundation: The Navigation Stack**
- **State:** `viewStack: ['projects' | 'messages' | 'chat']`. 
- **Transition:** `350ms cubic-bezier(0.2, 0.8, 0.2, 1)` (Apple Standard Spring).
- **Global UI (Mobile):** On mobile, the "Sidebar" and "Stage" are replaced by a full-screen card system.
- **Global UI (Desktop):** Unified solid white background. No floating cards or gaps. Sidebar and Stage are separated by a subtle 1px vertical divider.
- **Navigation Control:** A persistent floating round back button in the top-left corner (Scene 2 and 3) to enable navigation back through the stack, matching the iOS Messages style.

---

## **Scene 1: The Project Browser (Root)**
*The entry point. Visually identical to the Messages list style.*

### **1.1 Visual Anatomy**
- **Header:** Large Title "Projects" (`text-[34px] font-bold`).
- **List Items:** 
    - Card-style list identical to Scene 2.
    - **Avatar:** Folder icon or Project initials (`w-12 h-12`).
    - **Primary Text:** Project Name (`text-[17px] font-bold`).
    - **Secondary Text:** Number of sessions + Last activity.
- **Divider:** Visible hairline borders between cards.

### **1.2 The Bottom Control Dock**
- **Floating Bar:** `bg-white/80 backdrop-blur-md border-t border-black/[0.05] p-4 flex items-center gap-3`.
- **Search:** Rounded pill `[ Search Conversations ]` taking 80% width.
- **Action:** Circular "New" button (`w-12 h-12 bg-[#3478F6] text-white`).
- **Logic (New Chat):** Tapping "New" from this scene defaults to the **"maxwraae"** project and pushes directly to **Scene 3 (Chat)**.

---

## **Scene 2: The Conversation List (Project Hub)**
*Active when a specific project is selected.*

### **2.1 Navigation & Header**
- **Transition:** Slides in from right over Scene 1.
- **Header:** Back button `< Projects`. Large Title: `[Project Name]`.
- **Content:** List of all active and past sessions within that project.

### **2.2 The Bottom Control Dock**
- **Persistence:** The dock from Scene 1 remains visible.
- **Logic (New Chat):** Tapping "New" from this scene starts a conversation within the **currently viewed project** and pushes directly to **Scene 3 (Chat)**.

---

## **Scene 3: The Chat Interaction (Detail View)**
*The high-fidelity interaction layer.*

### **3.1 Header Anatomy**
- **Navigation:** Back button `< [Project Name]`. 
- **Identity:** Centered small avatar + Agent Title.

### **3.2 Canvas & Input**
- **Message Bubbles:** 
    - **User:** Solid Blue (`#007AFF`), white text, bottom-right tail.
    - **Agent:** Solid Gray (`#E9E9EB`), black text, bottom-left tail.
- **The Pill:** Docked white pill with gray border. 
    - Left of pill: `(+)` button.
    - Inside pill: `[ iMessage ]` placeholder + Microphone.
    - **Morphing:** If text exists, Microphone hides, and a Blue Send Arrow appears to the right of the pill.

---

## **Flow Logic Summary**
1.  **Launch** -> Scene 1 (Projects).
2.  **Tap Project** -> Slide to Scene 2 (Messages in Project).
3.  **Tap Message** -> Slide to Scene 3 (Live Chat).
4.  **Tap "New" (Scene 1)** -> Jump to Scene 3 (maxwraae project).
5.  **Tap "New" (Scene 2)** -> Jump to Scene 3 (Current project).
6.  **Edge Swipe (Left-to-Right)** -> Pops current scene off the stack.
