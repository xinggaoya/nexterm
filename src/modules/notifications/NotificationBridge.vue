<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { useNotification } from "naive-ui";
import { bindNotificationApi } from "./notificationCenter";

const notification = useNotification();
bindNotificationApi(notification);

onBeforeUnmount(() => {
  bindNotificationApi(null);
});
</script>

<template>
  <span aria-hidden="true" class="hidden" />
</template>
