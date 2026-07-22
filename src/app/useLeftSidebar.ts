import { computed, type ComputedRef, type Ref } from "vue";
import type {
  ActivityKey,
  LeftSidebarState,
} from "./useWorkbenchLayout";

export interface UseLeftSidebarApi {
  state: ComputedRef<LeftSidebarState>;
  isOpen: ComputedRef<boolean>;
  width: ComputedRef<number>;
  activity: ComputedRef<ActivityKey>;
  setActivity: (key: ActivityKey) => void;
  toggleOpen: () => void;
  setWidth: (w: number) => void;
}

export function useLeftSidebar(
  state: Ref<LeftSidebarState>,
  setActivity: (key: ActivityKey) => void,
  toggleOpen: () => void,
  setWidth: (w: number) => void,
): UseLeftSidebarApi {
  return {
    state: computed(() => state.value),
    isOpen: computed(() => state.value.open),
    width: computed(() => state.value.width),
    activity: computed(() => state.value.activity),
    setActivity,
    toggleOpen,
    setWidth,
  };
}