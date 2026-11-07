import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Loader2,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import type {
  ConfigFieldDto,
  SourceConfigDto,
  SourceInfoDto,
} from "@comicspace/contracts";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "../components/ui";
import { formatBytes } from "../lib/format";
import { UpdateSection } from "../components/UpdateSection";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => api.getSources(signal),
  });
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.getSettings(signal),
  });
  const cacheQuery = useQuery({
    queryKey: queryKeys.cache,
    queryFn: ({ signal }) => api.getCache(signal),
  });

  const reloadMutation = useMutation({
    mutationFn: () => api.reloadSources(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    },
  });
  const clearCacheMutation = useMutation({
    mutationFn: () => api.clearCache(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cache });
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="05 / Settings"
        title="设置"
        description="内容源、阅读缓存与本地服务配置。"
        actions={
          <Button
            size="sm"
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
          >
            <RefreshCw
              className={reloadMutation.isPending ? "size-4 animate-spin" : "size-4"}
            />
            重载插件
          </Button>
        }
      />

      <UpdateSection />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted">内容源</h2>
          <span className="text-xs text-muted">
            {sourcesQuery.data?.sources.length ?? 0} 个已加载
          </span>
        </div>

        {sourcesQuery.isLoading ? (
          <Spinner label="正在扫描插件" />
        ) : sourcesQuery.isError ? (
          <Card className="border-danger/30 text-sm text-danger">
            {sourcesQuery.error instanceof Error
              ? sourcesQuery.error.message
              : "无法加载内容源"}
          </Card>
        ) : (sourcesQuery.data?.sources.length ?? 0) === 0 ? (
          <Card className="text-sm leading-6 text-muted">
            没有发现插件。把插件文件夹放进{" "}
            <code className="rounded bg-surface-2 px-1 text-ink">plugins/</code>
            ，然后点击右上角“重载插件”。运行{" "}
            <code className="rounded bg-surface-2 px-1 text-ink">
              pnpm plugin:new my-source
            </code>{" "}
            可以从模板开始。
          </Card>
        ) : (
          <div className="space-y-2">
            {sourcesQuery.data?.sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        )}

        {sourcesQuery.data?.failures.length ? (
          <div className="space-y-2">
            {sourcesQuery.data.failures.map((failure) => (
              <div
                key={failure.dir}
                className="flex gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <div>
                  <div className="font-medium">{failure.sourceId} 加载失败</div>
                  <div className="mt-0.5 break-all text-danger/80">
                    {failure.message}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <SettingsForm
        settings={settingsQuery.data}
        loading={settingsQuery.isLoading}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted">阅读缓存</h2>
          <Button
            size="sm"
            variant="danger"
            onClick={() => clearCacheMutation.mutate()}
            disabled={clearCacheMutation.isPending || !cacheQuery.data}
          >
            <Trash2 className="size-3.5" /> 清空缓存
          </Button>
        </div>
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted" />
            <span className="text-muted">占用</span>
            <span className="font-medium">
              {cacheQuery.data ? formatBytes(cacheQuery.data.bytes) : "—"}
            </span>
          </div>
          <div className="text-muted">
            条目 <span className="text-ink">{cacheQuery.data?.entries ?? "—"}</span>
          </div>
          <div className="text-muted">
            上限{" "}
            <span className="text-ink">
              {cacheQuery.data ? formatBytes(cacheQuery.data.limitBytes) : "—"}
            </span>
          </div>
          <div className="text-muted">
            命中{" "}
            <span className="text-ink">{cacheQuery.data?.hits ?? 0}</span> / 未命中{" "}
            <span className="text-ink">{cacheQuery.data?.misses ?? 0}</span>
          </div>
        </Card>
        <p className="text-xs leading-5 text-muted">
          阅读时自动缓存页面图片，优先从本地磁盘读取；超过上限会按最久未访问淘汰。清空缓存不会影响下载、书架和阅读进度。
        </p>
      </section>

      <ThemeSection />

      <section className="rounded-2xl border border-line bg-surface p-4 text-xs leading-6 text-muted">
        <h2 className="mb-2 text-sm font-semibold text-ink">说明</h2>
        <p>
          ComicSpace 只提供本地阅读界面和插件框架，不附带任何内容源。请只接入你有权访问的
          API/内容，遵守来源站条款与当地法律。插件是本地可信代码，拥有完整 Node
          权限；请只安装你信任的插件。
        </p>
        <p className="mt-2">
          插件配置以明文保存在本地 SQLite 中；如果需要保存 Cookie/API Key，请自行评估风险。
        </p>
      </section>
    </div>
  );
}

function SourceCard({ source }: { source: SourceInfoDto }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{source.name}</span>
              <Badge>{source.version}</Badge>
              {source.status === "ready" ? (
                <Badge tone="success">就绪</Badge>
              ) : source.status === "needs_config" ? (
                <Badge tone="accent">需要配置</Badge>
              ) : source.status === "disabled" ? (
                <Badge>已停用</Badge>
              ) : (
                <Badge tone="danger">错误</Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted">
              {source.description || source.id}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          {source.capabilities.search ? <Badge>搜索</Badge> : null}
          {source.capabilities.browse ? <Badge>浏览</Badge> : null}
          {source.capabilities.filters ? <Badge>筛选</Badge> : null}
        </div>
      </div>
      {open ? (
        <div className="space-y-4 border-t border-line px-4 py-4">
          <SourceConfigForm source={source} />
          {source.capabilities.accountSync ? (
            <AccountSyncPanel sourceId={source.id} />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function SourceConfigForm({ source }: { source: SourceInfoDto }) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: queryKeys.sourceConfig(source.id),
    queryFn: ({ signal }) => api.getSourceConfig(source.id, signal),
  });
  const [values, setValues] = useState<
    Record<string, string | number | boolean>
  >({});
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [clearedSecrets, setClearedSecrets] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(source.enabled);

  useEffect(() => {
    if (!configQuery.data) return;
    const next: Record<string, string | number | boolean> = {};
    for (const field of source.configFields) {
      const value = configQuery.data.values[field.key];
      if (value !== null && value !== undefined) next[field.key] = value;
      else if (field.default !== undefined) next[field.key] = field.default;
    }
    setValues(next);
    setSecretInputs({});
    setClearedSecrets(new Set());
    setEnabled(configQuery.data.enabled);
  }, [configQuery.data, source.configFields]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string | number | boolean | null> = {};
      for (const field of source.configFields) {
        if (field.type === "password") {
          if (clearedSecrets.has(field.key)) payload[field.key] = null;
          else if (secretInputs[field.key]) payload[field.key] = secretInputs[field.key];
          continue;
        }
        const value = values[field.key];
        if (value !== undefined) payload[field.key] = value;
      }
      return api.updateSourceConfig(source.id, { enabled, values: payload });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.sourceConfig(source.id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    },
  });

  if (configQuery.isLoading) return <Spinner label="正在读取配置" />;
  if (configQuery.isError) {
    return (
      <p className="text-sm text-danger">
        {configQuery.error instanceof Error
          ? configQuery.error.message
          : "无法读取配置"}
      </p>
    );
  }

  const config = configQuery.data as SourceConfigDto | undefined;
  const hasFields = source.configFields.length > 0;

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--cs-accent)]"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        启用这个内容源
      </label>

      {hasFields ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {source.configFields.map((field) => (
            <ConfigInput
              key={field.key}
              field={field}
              value={values[field.key]}
              secretValue={secretInputs[field.key] ?? ""}
              secretSaved={
                Boolean(config?.secretKeys.includes(field.key)) &&
                !clearedSecrets.has(field.key)
              }
              onChange={(value) =>
                setValues((current) => ({ ...current, [field.key]: value }))
              }
              onSecretChange={(value) =>
                setSecretInputs((current) => ({ ...current, [field.key]: value }))
              }
              onClearSecret={() =>
                setClearedSecrets((current) => new Set(current).add(field.key))
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">这个源没有声明配置项。</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          保存配置
        </Button>
        {saveMutation.isError ? (
          <span className="text-xs text-danger">
            {saveMutation.error instanceof Error
              ? saveMutation.error.message
              : "保存失败"}
          </span>
        ) : null}
        {saveMutation.isSuccess ? (
          <span className="text-xs text-success">已保存</span>
        ) : null}
      </div>
    </div>
  );
}

function ConfigInput({
  field,
  value,
  secretValue,
  secretSaved,
  onChange,
  onSecretChange,
  onClearSecret,
}: {
  field: ConfigFieldDto;
  value: string | number | boolean | undefined;
  secretValue: string;
  secretSaved: boolean;
  onChange: (value: string | number | boolean) => void;
  onSecretChange: (value: string) => void;
  onClearSecret: () => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--cs-accent)]"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={field.label} description={field.description}>
        <Select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">请选择</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (field.type === "number") {
    return (
      <Field label={field.label} description={field.description}>
        <Input
          type="number"
          min={field.min}
          max={field.max}
          value={typeof value === "number" ? value : ""}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? 0 : Number(event.target.value),
            )
          }
        />
      </Field>
    );
  }
  if (field.type === "password") {
    return (
      <Field label={field.label} description={field.description}>
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            value={secretValue}
            placeholder={secretSaved ? "已保存（留空保持不变）" : field.placeholder}
            onChange={(event) => onSecretChange(event.target.value)}
          />
          {secretSaved ? (
            <Button variant="ghost" size="sm" onClick={onClearSecret}>
              清除
            </Button>
          ) : null}
        </div>
      </Field>
    );
  }
  return (
    <Field label={field.label} description={field.description}>
      <Input
        type={field.type === "url" ? "url" : "text"}
        value={typeof value === "string" ? value : ""}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function SettingsForm({
  settings,
  loading,
}: {
  settings: Awaited<ReturnType<typeof api.getSettings>> | undefined;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [hosts, setHosts] = useState("");
  const [cacheLimit, setCacheLimit] = useState(1024);
  const [proxyUrl, setProxyUrl] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.updateSettings({
        imageExtraAllowedHosts: hosts
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        cacheLimitMb: cacheLimit,
        proxyUrl: proxyUrl.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cache });
    },
  });

  useEffect(() => {
    if (!settings) return;
    setHosts(settings.imageExtraAllowedHosts.join(", "));
    setCacheLimit(settings.cacheLimitMb);
    setProxyUrl(settings.proxyUrl);
  }, [settings]);

  if (loading) return <Spinner label="正在加载设置" />;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted">
        <Settings2 className="size-4" /> 本地设置
      </h2>
      <Card className="space-y-4">
        <Field
          label="图片代理额外允许主机"
          description="逗号分隔。默认只允许公网地址；如果你使用局域网镜像，在这里加入主机名（可带端口）。"
        >
          <Input
            value={hosts}
            onChange={(event) => setHosts(event.target.value)}
            placeholder="127.0.0.1:8787, 192.168.1.20"
          />
        </Field>
        <Field
          label="网络代理"
          description="只支持 http/https 代理，例如 http://127.0.0.1:7890；留空表示直连。插件请求、章节图片和下载都会使用它（插件自己配置了 proxyUrl 时以插件为准）。"
        >
          <Input
            value={proxyUrl}
            onChange={(event) => setProxyUrl(event.target.value)}
            placeholder="http://127.0.0.1:7890"
            spellCheck={false}
          />
        </Field>
        <Field
          label="阅读缓存上限（MB）"
          description="128–10240 MB。超过后按最久未访问淘汰。"
        >
          <Input
            type="number"
            min={128}
            max={10240}
            value={cacheLimit}
            onChange={(event) => setCacheLimit(Number(event.target.value))}
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            保存设置
          </Button>
          {mutation.isError ? (
            <span className="text-xs text-danger">
              {mutation.error instanceof Error
                ? mutation.error.message
                : "保存失败"}
            </span>
          ) : null}
          {mutation.isSuccess ? (
            <span className="text-xs text-success">已保存</span>
          ) : null}
        </div>
        {settings ? (
          <div className="grid gap-1 text-[11px] text-muted">
            <div>数据目录：{settings.dataDir}</div>
            <div>插件目录：{settings.pluginsDir}</div>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

function AccountSyncPanel({ sourceId }: { sourceId: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.syncAccount(sourceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library });
      void queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
  });

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <h3 className="text-sm font-medium">从网站同步</h3>
      <p className="text-xs leading-5 text-muted">
        桌面版会打开网站窗口。请在窗口里登录，软件只读取页面上已经显示的收藏和「最後閱讀」章节，不会把密码发到聊天，也不会写回网站。本地已有记录会保留；同一章节以时间较新的进度为准，时间相同则保留读得更远的页。未登录、翻页失败或页面结构变化时会停下来，不会显示成同步成功。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          <RefreshCw
            className={mutation.isPending ? "size-3.5 animate-spin" : "size-3.5"}
          />
          {mutation.isPending ? "正在同步…" : "从网站同步收藏和历史"}
        </Button>
      </div>
      {mutation.isError ? (
        <p className="whitespace-pre-wrap text-xs leading-5 text-danger" role="alert">
          {mutation.error instanceof Error ? mutation.error.message : "同步失败"}
        </p>
      ) : null}
      {mutation.data ? (
        <p className="whitespace-pre-wrap text-xs leading-5 text-muted" role="status">
          {mutation.data.message}
        </p>
      ) : null}
    </div>
  );
}

function ThemeSection() {
  const [theme, setTheme] = useState(
    () => window.localStorage.getItem("comicspace:theme") ?? "light",
  );

  useEffect(() => {
    const root = document.documentElement;
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    root.dataset.theme = resolved;
    window.localStorage.setItem("comicspace:theme", theme);
  }, [theme]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted">外观</h2>
      <Card className="flex flex-wrap items-center gap-3">
        <span className="text-sm">主题</span>
        <Select
          value={theme}
          onChange={(event) => setTheme(event.target.value)}
          className="max-w-40"
        >
          <option value="light">浅色</option>
          <option value="dark">深色</option>
          <option value="system">跟随系统</option>
        </Select>
      </Card>
    </section>
  );
}
