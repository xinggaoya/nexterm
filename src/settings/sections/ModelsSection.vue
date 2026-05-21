<script setup lang="ts">
import {
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  useMessage,
} from "naive-ui";
import { computed, onMounted, ref } from "vue";
import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  MODELS,
  PROVIDERS,
  providerSupportsKey,
  type AutocompleteProviderId,
  type ModelId,
  type ProviderId,
} from "@/modules/ai/config";
import {
  EMPTY_PROVIDER_KEYS,
  clearKey,
  getAllKeys,
  setKey,
  type ProviderKeys,
} from "@/modules/ai/lib/keyring";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { emitKeysChanged } from "@/modules/settings/store";
import ProviderKeyCard from "../components/ProviderKeyCard.vue";

const prefs = usePreferencesPiniaStore();
const message = useMessage();
const providerKeys = ref<ProviderKeys>({ ...EMPTY_PROVIDER_KEYS });
const loadingKeys = ref(false);

const modelOptions = MODELS.map((model) => ({
  label: `${model.label} · ${model.hint}`,
  value: model.id,
}));

const providerOptions = PROVIDERS.map((provider) => ({
  label: provider.label,
  value: provider.id,
}));

const autocompleteModelValue = computed(() => {
  const fallback = DEFAULT_AUTOCOMPLETE_MODEL[prefs.autocompleteProvider] ?? "";
  return prefs.autocompleteModelId || fallback;
});

const keyProviders = computed(() =>
  PROVIDERS.filter((provider) => providerSupportsKey(provider.id)),
);

async function refreshKeys() {
  loadingKeys.value = true;
  try {
    providerKeys.value = await getAllKeys();
  } finally {
    loadingKeys.value = false;
  }
}

async function saveProviderKey(provider: ProviderId, key: string) {
  await setKey(provider, key);
  providerKeys.value = { ...providerKeys.value, [provider]: key };
  await emitKeysChanged();
  message.success("API key saved");
}

async function clearProviderKey(provider: ProviderId) {
  await clearKey(provider);
  providerKeys.value = { ...providerKeys.value, [provider]: null };
  await emitKeysChanged();
  message.success("API key removed");
}

onMounted(() => {
  void refreshKeys();
});
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">Models</h1>
      <p class="mt-1 text-xs text-muted-foreground">
        Model defaults, autocomplete, and local provider endpoints.
      </p>
    </div>

    <NCard size="small" title="Default assistant" embedded>
      <NForm label-placement="left" label-width="160" size="small">
        <NFormItem label="Default model">
          <NSelect
            :value="prefs.defaultModelId"
            :options="modelOptions"
            filterable
            @update:value="(value) => prefs.updateDefaultModel(value as ModelId)"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="Provider keys" embedded>
      <div v-if="loadingKeys" class="py-2 text-xs text-muted-foreground">
        Loading keys...
      </div>
      <div class="grid gap-2">
        <ProviderKeyCard
          v-for="provider in keyProviders"
          :key="provider.id"
          :provider="provider"
          :current-key="providerKeys[provider.id]"
          :save-key="(key) => saveProviderKey(provider.id, key)"
          :clear-key-value="() => clearProviderKey(provider.id)"
        />
      </div>
    </NCard>

    <NCard size="small" title="Autocomplete" embedded>
      <NForm label-placement="left" label-width="160" size="small">
        <NFormItem label="Enabled">
          <NSwitch
            :value="prefs.autocompleteEnabled"
            @update:value="prefs.updateAutocompleteEnabled"
          />
        </NFormItem>
        <NFormItem label="Provider">
          <NSelect
            :value="prefs.autocompleteProvider"
            :options="providerOptions"
            filterable
            @update:value="(value) => prefs.updateAutocompleteProvider(value as AutocompleteProviderId)"
          />
        </NFormItem>
        <NFormItem label="Model ID">
          <NInput
            :value="autocompleteModelValue"
            placeholder="Provider model id"
            @update:value="prefs.updateAutocompleteModelId"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="OpenAI compatible" embedded>
      <NForm label-placement="left" label-width="160" size="small">
        <NFormItem label="Base URL">
          <NInput
            :value="prefs.openaiCompatibleBaseURL"
            placeholder="https://api.example.com/v1"
            @update:value="prefs.updateOpenaiCompatibleBaseURL"
          />
        </NFormItem>
        <NFormItem label="Model ID">
          <NInput
            :value="prefs.openaiCompatibleModelId"
            placeholder="model-name"
            @update:value="prefs.updateOpenaiCompatibleModelId"
          />
        </NFormItem>
        <NFormItem label="Context limit">
          <NInputNumber
            :value="prefs.openaiCompatibleContextLimit"
            :min="1000"
            @update:value="(value) => prefs.updateOpenaiCompatibleContextLimit(value ?? 128000)"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="Local endpoints" embedded>
      <NForm label-placement="left" label-width="160" size="small">
        <NFormItem label="LM Studio URL">
          <NInput :value="prefs.lmstudioBaseURL" @update:value="prefs.updateLmstudioBaseURL" />
        </NFormItem>
        <NFormItem label="LM Studio model">
          <NInput :value="prefs.lmstudioModelId" @update:value="prefs.updateLmstudioModelId" />
        </NFormItem>
        <NFormItem label="MLX URL">
          <NInput :value="prefs.mlxBaseURL" @update:value="prefs.updateMlxBaseURL" />
        </NFormItem>
        <NFormItem label="MLX model">
          <NInput :value="prefs.mlxModelId" @update:value="prefs.updateMlxModelId" />
        </NFormItem>
        <NFormItem label="Ollama URL">
          <NInput :value="prefs.ollamaBaseURL" @update:value="prefs.updateOllamaBaseURL" />
        </NFormItem>
        <NFormItem label="Ollama model">
          <NInput :value="prefs.ollamaModelId" @update:value="prefs.updateOllamaModelId" />
        </NFormItem>
      </NForm>
    </NCard>
  </section>
</template>
