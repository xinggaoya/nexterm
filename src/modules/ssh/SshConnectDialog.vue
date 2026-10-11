<script setup lang="ts">
import { normalizeErrorMessage } from "@/lib/error";
import { computed, onMounted, ref } from "vue";
import {
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSpin,
  NTabPane,
  NTabs,
} from "naive-ui";
import { t } from "@/modules/i18n/translate";
import { ssh, type SshKnownHostEntry, type SshProfile } from "@/lib/native";

export type SshConnectResult = {
  profile: SshProfile;
  secret: string;
  home: string;
};

const emit = defineEmits<{
  confirm: [result: SshConnectResult];
  cancel: [];
}>();

type Tab = "connect" | "hosts";

const tab = ref<Tab>("connect");
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

// 主机密钥信任库（TOFU）
const knownHosts = ref<SshKnownHostEntry[]>([]);
const loadingHosts = ref(false);

// 编辑已有档案：复用同一套表单字段，`editingId` 非空即为编辑态
const editingId = ref<string | null>(null);

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
    error.value = normalizeErrorMessage(err);
  } finally {
    loadingProfiles.value = false;
  }
}

async function refreshKnownHosts() {
  loadingHosts.value = true;
  try {
    knownHosts.value = await ssh.knownHostsList();
  } catch (err) {
    error.value = normalizeErrorMessage(err);
  } finally {
    loadingHosts.value = false;
  }
}

/** 公钥太长时中间省略，只留首尾 —— 足够肉眼比对指纹。 */
function shortKey(publicKey: string): string {
  if (publicKey.length <= 56) return publicKey;
  return `${publicKey.slice(0, 32)}…${publicKey.slice(-16)}`;
}

async function forgetKnownHost(host: string) {
  try {
    await ssh.knownHostsRemove(host);
    await refreshKnownHosts();
  } catch (err) {
    error.value = normalizeErrorMessage(err);
  }
}

function startEditing(profile: SshProfile) {
  editingId.value = profile.id;
  creating.value = true;
  formName.value = profile.name;
  formHost.value = profile.host;
  formPort.value = profile.port;
  formUsername.value = profile.username;
  formAuth.value = profile.authMethod.kind;
  formKeyPath.value = profile.authMethod.kind === "key" ? profile.authMethod.keyPath : "";
  tab.value = "connect";
}

function resetForm() {
  editingId.value = null;
  creating.value = false;
  formName.value = "";
  formHost.value = "";
  formPort.value = 22;
  formUsername.value = "root";
  formAuth.value = "password";
  formKeyPath.value = "";
}

async function deleteProfile(id: string) {
  try {
    await ssh.profileDelete(id);
    if (selectedId.value === id) selectedId.value = null;
    if (editingId.value === id) resetForm();
    await refreshProfiles();
  } catch (err) {
    error.value = normalizeErrorMessage(err);
  }
}

async function saveNewProfile(): Promise<SshProfile | null> {
  if (!formName.value.trim() || !formHost.value.trim() || !formUsername.value.trim()) {
    error.value = t("ssh.dialog.formIncomplete");
    return null;
  }
  // 编辑态保留原 id（后端按 id upsert），新建态传空串让后端生成。
  const profile = await ssh.profileSave({
    id: editingId.value ?? "",
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
  resetForm();
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
    error.value = normalizeErrorMessage(err);
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
    style="max-width: 520px"
    @positive-click="confirmConnect"
    @negative-click="emit('cancel')"
    @close="emit('cancel')"
    @mask-click="emit('cancel')"
  >
    <NTabs v-model:value="tab" size="small" type="line">
      <NTabPane name="connect" :tab="t('ssh.dialog.connect')">
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
                <div
                  v-for="profile in profiles"
                  :key="profile.id"
                  class="flex items-center gap-2"
                >
                  <NRadioButton :value="profile.id" class="min-w-0 flex-1">
                    <span class="block truncate">
                      {{ profile.name }} · {{ profile.username }}@{{ profile.host }}:{{ profile.port }}
                    </span>
                  </NRadioButton>
                  <NButton
                    size="tiny"
                    quaternary
                    :data-edit-profile="profile.id"
                    @click="startEditing(profile)"
                  >
                    {{ t("common.edit") }}
                  </NButton>
                  <NPopconfirm @positive-click="deleteProfile(profile.id)">
                    <template #trigger>
                      <NButton size="tiny" quaternary type="error" :data-delete-profile="profile.id">
                        {{ t("common.delete") }}
                      </NButton>
                    </template>
                    {{ t("ssh.dialog.deleteConfirm") }}
                  </NPopconfirm>
                </div>
              </div>
            </NRadioGroup>

            <div
              v-if="creating"
              class="flex flex-col gap-2 rounded-[6px] border border-border/60 p-2.5"
            >
              <NInput
                v-model:value="formName"
                :placeholder="t('ssh.dialog.profileName')"
                size="small"
              />
              <div class="flex gap-2">
                <NInput
                  v-model:value="formHost"
                  :placeholder="t('ssh.dialog.host')"
                  size="small"
                  class="flex-1"
                />
                <NInputNumber
                  v-model:value="formPort"
                  :min="1"
                  :max="65535"
                  size="small"
                  class="w-24"
                  :show-button="false"
                />
              </div>
              <NInput
                v-model:value="formUsername"
                :placeholder="t('ssh.dialog.username')"
                size="small"
              />
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

            <div class="flex items-center gap-3">
              <button
                type="button"
                class="self-start text-xs text-primary hover:underline"
                @click="creating ? resetForm() : (creating = true)"
              >
                {{
                  creating
                    ? t("ssh.dialog.useExisting")
                    : editingId
                      ? t("common.cancel")
                      : t("ssh.dialog.newProfile")
                }}
              </button>
            </div>
          </template>

          <div
            v-if="error"
            class="break-words rounded-[6px] border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
          >
            {{ error }}
          </div>
        </div>
      </NTabPane>

      <NTabPane name="hosts" :tab="t('ssh.dialog.knownHosts')">
        <div class="flex flex-col gap-3 text-[13px]">
          <p class="m-0 text-xs leading-relaxed text-muted-foreground">
            {{ t("ssh.dialog.knownHostsHint") }}
          </p>
          <div v-if="loadingHosts" class="flex items-center gap-2 text-muted-foreground">
            <NSpin size="small" />
          </div>
          <p
            v-else-if="knownHosts.length === 0"
            class="m-0 text-xs text-muted-foreground"
            data-known-hosts-empty
          >
            {{ t("ssh.dialog.knownHostsEmpty") }}
          </p>
          <ul v-else class="m-0 flex list-none flex-col gap-1.5 p-0">
            <li
              v-for="entry in knownHosts"
              :key="`${entry.host}:${entry.keyType}`"
              class="flex items-center gap-2 rounded-[6px] border border-border/60 px-2 py-1.5"
              :data-known-host="entry.host"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ entry.host }}</span>
                <span class="block truncate font-mono text-[11px] text-muted-foreground">
                  {{ entry.keyType }} {{ shortKey(entry.publicKey) }}
                </span>
              </span>
              <NButton
                size="tiny"
                quaternary
                type="error"
                :data-forget-host="entry.host"
                @click="forgetKnownHost(entry.host)"
              >
                {{ t("ssh.dialog.forget") }}
              </NButton>
            </li>
          </ul>
        </div>
      </NTabPane>
    </NTabs>
  </NModal>
</template>
