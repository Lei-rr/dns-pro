<template>
  <section>
    <div class="page-toolbar">
      <div>
        <a-typography-title :level="3" style="margin-bottom: 4px">服务商</a-typography-title>
        <a-typography-text type="secondary"
          >管理 DNS 和 EdgeOne 服务商配置。已保存的密钥不会明文显示。</a-typography-text
        >
      </div>
      <div class="page-actions">
        <a-button type="primary" @click="openCreate">新增服务商</a-button>
        <a-button :loading="loading" @click="load">刷新</a-button>
      </div>
    </div>
    <a-table
      :data-source="providers"
      :row-key="providerRowKey"
      :loading="loading"
      :pagination="false"
      :columns="[
        { title: '排序', key: 'sort', width: 64 },
        { title: '服务商', key: 'name', width: 280 },
        { title: 'API 配置', key: 'fields', width: 420 },
        { title: '操作', key: 'actions', width: 150, align: 'right' },
      ]"
      size="middle"
      :scroll="{ x: 920 }"
      :custom-row="providerRowProps"
      :locale="{ emptyText: '暂无服务商配置' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'sort'">
          <a-typography-text type="secondary" style="cursor: grab" title="拖动调整顺序" v-bind="sortHandleProps(record)"
            >☰</a-typography-text
          >
        </template>
        <template v-else-if="column.key === 'name'">
          <a-space>
            <a-tag>{{ providerDefinition(record.type)?.name || record.type }}</a-tag>
            <span>{{ record.name }}</span>
            <a-typography-text type="secondary">{{ record.id }}</a-typography-text>
          </a-space>
        </template>
        <template v-else-if="column.key === 'fields'">
          <a-space direction="vertical" size="small" style="width: 100%">
            <div
              v-for="item in configItems(record)"
              :key="item.key"
              style="display: flex; align-items: flex-start; justify-content: flex-start; gap: 8px; flex-wrap: wrap"
            >
              <a-tag :color="item.color" style="margin-inline-end: 0">{{ item.value }}</a-tag>
            </div>
          </a-space>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space size="small">
            <a-button
              type="link"
              size="small"
              :loading="providerOperationLoading(record.id, 'test')"
              :disabled="!!providerOperation"
              @click="testProvider(record)"
              >测通</a-button
            >
            <a-button type="link" size="small" :disabled="!!providerOperation" @click="edit(record)">更新</a-button>
            <a-button
              type="link"
              size="small"
              danger
              :loading="providerOperationLoading(record.id, 'delete')"
              :disabled="!!providerOperation"
              @click="askDelete(record)"
              >删除</a-button
            >
          </a-space>
        </template>
      </template>
    </a-table>
    <a-modal
      :open="!!editing"
      :title="editing ? '更新 ' + editing.name + ' 服务商配置' : ''"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      @ok="save"
      @cancel="editing = null"
      @update:open="handleEditOpenChange"
    >
      <a-alert
        type="info"
        show-icon
        style="margin-bottom: 16px"
        message="留空的字段不会覆盖现有配置；如需清空请使用清除。"
      />
      <a-form v-if="editing" layout="vertical">
        <a-form-item label="配置标识">
          <a-input :value="editing.id" disabled />
        </a-form-item>
        <a-form-item label="显示名称">
          <a-input v-model:value="form.name" placeholder="留空使用默认名称" />
        </a-form-item>
        <a-form-item v-for="field in editing.editable_fields" :key="field" :label="fieldLabel(field)">
          <a-select
            v-if="isProviderSelectField(field)"
            v-model:value="form[field]"
            :placeholder="selectFieldPlaceholder(field)"
          >
            <a-select-option v-for="provider in selectFieldProviders(field)" :key="provider.id" :value="provider.id"
              >{{ provider.name }}（{{ provider.id }}）</a-select-option
            >
          </a-select>
          <a-input-password
            v-else-if="isSecretField(field)"
            v-model:value="form[field]"
            :placeholder="editing.fields[field] || '未配置'"
          />
          <a-input v-else v-model:value="form[field]" :placeholder="editing.fields[field] || '未配置'" />
        </a-form-item>
      </a-form>
    </a-modal>
    <a-modal
      v-model:open="creating"
      title="新增服务商"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      @ok="create"
    >
      <a-form layout="vertical">
        <a-form-item label="类型" required>
          <a-select :value="createForm.type" @change="onCreateTypeChange">
            <a-select-option
              v-for="providerType in providerTypes"
              :key="providerType.type"
              :value="providerType.type"
              >{{ providerType.name }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item label="配置标识" required>
          <a-input v-model:value="createForm.id" placeholder="例如 dnspod-main / dnspod-work" />
          <a-typography-text type="secondary"
            >用于区分多个账号，也会作为访问路径；只能用字母、数字、-、_，不能使用
            home、login、providers、user</a-typography-text
          >
        </a-form-item>
        <a-form-item label="显示名称">
          <a-input v-model:value="createForm.name" placeholder="留空使用默认名称" />
        </a-form-item>
        <a-form-item
          v-for="field in createFields(createForm.type)"
          :key="field"
          :label="fieldLabel(field)"
          :required="requiredFields(createForm.type).includes(field)"
        >
          <a-select
            v-if="isProviderSelectField(field)"
            v-model:value="createForm[field]"
            :placeholder="selectFieldPlaceholder(field)"
          >
            <a-select-option v-for="provider in selectFieldProviders(field)" :key="provider.id" :value="provider.id"
              >{{ provider.name }}（{{ provider.id }}）</a-select-option
            >
          </a-select>
          <a-input-password v-else-if="isSecretField(field)" v-model:value="createForm[field]" />
          <a-input v-else v-model:value="createForm[field]" />
        </a-form-item>
      </a-form>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useProviderList } from '../composables/useProviderList'
import { useProviderCrud } from '../composables/useProviderCrud'
import { useProviderSort } from '../composables/useProviderSort'

const list = useProviderList()
const sort = useProviderSort(list.providers)
const crud = useProviderCrud({
  load: list.load,
  providerDefinition: list.providerDefinition,
  fieldLabel: list.fieldLabel,
  requiredFields: list.requiredFields,
  isProviderSelectField: list.isProviderSelectField,
  isSecretField: list.isSecretField,
  selectFieldProviders: list.selectFieldProviders,
  selectFieldPlaceholder: list.selectFieldPlaceholder,
  createFields: list.createFields,
})

const {
  providers,
  loading,
  providerTypes,
  providerRowKey,
  loadProviderDefinitions,
  load,
  providerDefinition,
  fieldLabel,
  requiredFields,
  isProviderSelectField,
  selectFieldProviders,
  selectFieldPlaceholder,
  isSecretField,
  createFields,
  configItems,
} = list

const { sortHandleProps, providerRowProps } = sort

const {
  editing,
  creating,
  form,
  createForm,
  saving,
  providerOperation,
  providerOperationLoading,
  handleEditOpenChange,
  edit,
  openCreate,
  onCreateTypeChange,
  create,
  save,
  askDelete,
  testProvider,
} = crud

onMounted(async () => {
  await loadProviderDefinitions()
  await load()
})
</script>
