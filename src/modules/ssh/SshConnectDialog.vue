<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NInput, NInputNumber, NModal, NRadioButton, NRadioGroup, NSpin } from "naive-ui";
import { t } from "@/modules/i18n/translate";
import { ssh, type SshProfile } from "@/lib/native";

export type SshConnectResult = {
  profile: SshProfile;
  secret: string;
  home: string;
};

const emit = defineEmits<{
  confirm: [result: SshConnectResult];
  cancel: [];
}>();

const profiles = ref<SshProfile[]>([]);
const loadingProfiles = ref(true);
const selectedId = ref<string | null>(null);
const secret = ref("");
const creating = ref(false);
const connecting = ref(false);
const error = ref<string | null>(null);

// 新建连接表单
const formName = ref("");
const formHost = ref("");
const formPort = ref(22);
const formUsername = ref("root");
const formAuth = ref<"password" | "key">("password");
const formKeyPath = ref("");

const selectedProfile = computed(
  () => profiles.value.find((profile) => profile.id === selectedId.value) ?? null,
);
const secretPlaceholder = computed(() =>
  selectedProfile.value?.authMethod.kind === "key" || (creating.value && formAuth.value === "key")
    ? t("ssh.dialog.passphrasePlaceholder")
    : t("ssh.dialog.passwordPlaceholder"),
);

async function refreshProfiles() {
  loadingProfiles.value = true;
  try {
    profiles.value = await ssh.profileList();
    if (!selectedId.value && profiles.value.length > 0) {
      selectedId.value = profiles.value[0]?.id ?? null;
    }
  } catch (err) {
    error.value = String(err);
  } finally {
    loadingProfiles.value = false;
  }
}

async function saveNewProfile(): Promise<SshProfile | null> {
  if (!formName.value.trim() || !formHost.value.trim() || !formUsername.value.trim()) {
    error.value = t("ssh.dialog.formIncomplete");
    return null;
  }
  const profile = await ssh.profileSave({
    id: "",
    name: formName.value.trim(),
    host: formHost.value.trim(),
    port: Number(formPort.value) || 22,
    username: formUsername.value.trim(),
    authMethod:
      formAuth.value === "key"
        ? { kind: "key", keyPath: formKeyPath.value.trim() }
        : { kind: "password" },
    createdAt: 0,
  });
  await refreshProfiles();
  selectedId.value = profile.id;
  creating.value = false;
  return profile;
}

async function confirmConnect() {
  error.value = null;
  connecting.value = true;
  try {
    let profile = selectedProfile.value;
    if (creating.value) {
      profile = await saveNewProfile();
      if (!profile) return;
    }
    if (!profile) {
      error.value = t("ssh.dialog.selectProfile");
      return;
    }
    const probe = await ssh.connectTest(profile, secret.value || null);
    emit("confirm", { profile, secret: secret.value, home: probe.home });
  } catch (err) {
    error.value = String(err);
  } finally {
    connecting.value = false;
  }
}

onMounted(() => {
  void refreshProfiles();
});
</script>

<template>
  <NModal
    :show="true"
    preset="dialog"
    :title="t('ssh.dialog.title')"
    :show-cancel-button="true"
    :negative-text="t('common.cancel')"
    :positive-text="t('ssh.dialog.connect')"
    :loading="connecting"
    style="max-width: 460px"
    @positive-click="confirmConnect"
    @negative-click="emit('cancel')"
    @close="emit('cancel')"
    @mask-click="emit('cancel')"
  >
    <div class="flex flex-col gap-3 text-[13px]">
      <div v-if="loadingProfiles" class="flex items-center gap-2 py-2 text-muted-foreground">
        <NSpin size="small" />
        <span>{{ t("ssh.dialog.loadingProfiles") }}</span>
      </div>
      <template v-else>
        <NRadioGroup
          v-if="!creating && profiles.length > 0"
          v-model:value="selectedId"
          name="ssh-profile"
        >
          <div class="flex flex-col gap-1.5">
            <NRadioButton
              v-for="profile in profiles"
              :key="profile.id"
              :value="profile.id"
              class="w-full"
            >
              <span class="block truncate">
                {{ profile.name }} · {{ profile.username }}@{{ profile.host }}:{{ profile.port }}
              </span>
            </NRadioButton>
          </div>
        </NRadioGroup>

        <div v-if="creating" class="flex flex-col gap-2 rounded-[6px] border border-border/60 p-2.5">
          <NInput v-model:value="formName" :placeholder="t('ssh.dialog.profileName')" size="small" />
          <div class="flex gap-2">
            <NInput v-model:value="formHost" :placeholder="t('ssh.dialog.host')" size="small" class="flex-1" />
            <NInputNumber
              v-model:value="formPort"
              :min="1"
              :max="65535"
              size="small"
              class="w-24"
              :show-button="false"
            />
          </div>
          <NInput v-model:value="formUsername" :placeholder="t('ssh.dialog.username')" size="small" />
          <NRadioGroup v-model:value="formAuth" name="ssh-auth" size="small">
            <NRadioButton value="password">{{ t("ssh.auth.password") }}</NRadioButton>
            <NRadioButton value="key">{{ t("ssh.auth.key") }}</NRadioButton>
          </NRadioGroup>
          <NInput
            v-if="formAuth === 'key'"
            v-model:value="formKeyPath"
            :placeholder="t('ssh.dialog.keyPath')"
            size="small"
          />
        </div>

        <NInput
          v-model:value="secret"
          type="password"
          show-password-on="click"
          :placeholder="secretPlaceholder"
          size="small"
          @keyup.enter="confirmConnect"
        />

        <button
          type="button"
          class="self-start text-xs text-primary hover:underline"
          @click="creating = !creating"
        >
          {{ creating ? t("ssh.dialog.useExisting") : t("ssh.dialog.newProfile") }}
        </button>
      </template>

      <div
        v-if="error"
        class="break-words rounded-[6px] border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
      >
        {{ error }}
      </div>
    </div>
  </NModal>
</template>
