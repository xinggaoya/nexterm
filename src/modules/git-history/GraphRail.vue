<script setup lang="ts">
import { computed } from "vue";
import type { GraphEdge, GraphRow } from "./lib/graph";

const props = defineProps<{
  row: GraphRow;
  rowHeight: number;
  maxLaneCount: number;
  active?: boolean;
}>();

const LANE_WIDTH = 14;
const RAIL_PADDING_X = 8;
const MAX_VISIBLE_LANES = 6;
const STRAIGHT_WIDTH = 1.5;
const CURVE_WIDTH = 1.5;

const width = computed(() => railWidth(props.maxLaneCount));
const midY = computed(() => Math.round(props.rowHeight / 2));
const nodeX = computed(() => laneX(props.row.lane));
const visible = computed(() => Math.min(props.maxLaneCount, MAX_VISIBLE_LANES));
const overflow = computed(() => props.row.laneCount > visible.value);

function laneX(lane: number): number {
  return RAIL_PADDING_X + lane * LANE_WIDTH;
}

function railWidth(maxLane: number): number {
  const lanes = Math.min(maxLane, MAX_VISIBLE_LANES);
  return RAIL_PADDING_X * 2 + Math.max(0, lanes - 1) * LANE_WIDTH + 6;
}

function topPath(edge: GraphEdge): string {
  if (edge.kind !== "merge") return "";
  const xFrom = laneX(edge.fromLane);
  const xTo = laneX(edge.toLane);
  const c1y = midY.value * 0.55;
  return `M ${xFrom} 0 C ${xFrom} ${c1y}, ${xTo} ${c1y}, ${xTo} ${midY.value}`;
}

function bottomPath(edge: GraphEdge): string {
  if (edge.kind !== "branch") return "";
  const xFrom = laneX(edge.fromLane);
  const xTo = laneX(edge.toLane);
  const c1y = midY.value + (props.rowHeight - midY.value) * 0.45;
  return `M ${xFrom} ${midY.value} C ${xFrom} ${c1y}, ${xTo} ${c1y}, ${xTo} ${props.rowHeight}`;
}
</script>

<template>
  <svg
    :width="width"
    :height="props.rowHeight"
    :viewBox="`0 0 ${width} ${props.rowHeight}`"
    aria-hidden="true"
    class="shrink-0 overflow-visible"
  >
    <template v-for="edge in props.row.topEdges" :key="`t-${edge.kind}-${JSON.stringify(edge)}`">
      <line
        v-if="edge.kind === 'straight'"
        :x1="laneX(edge.lane)"
        y1="0"
        :x2="laneX(edge.lane)"
        :y2="midY"
        :stroke="edge.color"
        :stroke-width="STRAIGHT_WIDTH"
        stroke-linecap="round"
      />
      <path
        v-else-if="edge.kind === 'merge'"
        :d="topPath(edge)"
        fill="none"
        :stroke="edge.color"
        :stroke-width="CURVE_WIDTH"
        stroke-linecap="round"
      />
    </template>

    <template v-for="edge in props.row.bottomEdges" :key="`b-${edge.kind}-${JSON.stringify(edge)}`">
      <line
        v-if="edge.kind === 'straight'"
        :x1="laneX(edge.lane)"
        :y1="midY"
        :x2="laneX(edge.lane)"
        :y2="props.rowHeight"
        :stroke="edge.color"
        :stroke-width="STRAIGHT_WIDTH"
        stroke-linecap="round"
      />
      <path
        v-else-if="edge.kind === 'branch'"
        :d="bottomPath(edge)"
        fill="none"
        :stroke="edge.color"
        :stroke-width="CURVE_WIDTH"
        stroke-linecap="round"
      />
    </template>

    <circle
      :cx="nodeX"
      :cy="midY"
      :r="props.active ? 4.6 : 3.6"
      :fill="props.row.nodeColor"
      stroke="var(--background)"
      stroke-width="1.5"
    />
    <circle
      v-if="props.active"
      :cx="nodeX"
      :cy="midY"
      r="6.5"
      fill="none"
      :stroke="props.row.nodeColor"
      stroke-opacity="0.35"
      stroke-width="1.4"
    />
    <text
      v-if="overflow"
      :x="width - 4"
      :y="midY + 3"
      text-anchor="end"
      class="fill-muted-foreground"
      style="font-size: 8px"
    >
      +{{ props.row.laneCount - visible }}
    </text>
  </svg>
</template>
