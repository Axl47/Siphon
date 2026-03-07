import { writable } from "svelte/store";

import type { SiphonFlowState } from "./types";

export const siphonFlow = writable<SiphonFlowState>({ screen: "main" });

export const setSiphonScreen = (state: SiphonFlowState) => {
    siphonFlow.set(state);
};
