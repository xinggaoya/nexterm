/**
 * explorer 模块的公开类型。
 *
 * 单独成文件而不是塞进 SFC 的 `<script setup>`：`<script setup>` 不允许
 * `export`，而 FileExplorer 与 ExplorerSearchPanel 都要引用这个联合类型。
 */

/** 统一搜索抽屉的三个分段。 */
export type ExplorerSearchMode = "files" | "content" | "filter";
