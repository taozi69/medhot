import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import type { Route } from "./+types/llm-pool";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction, useAdminMe } from "../../features/admin/action";
import { toast } from "../../features/admin/toast";
import { AdminPage, Badge, Button, Card, DataTable, Empty, Field, Input, ReasonDialog } from "../../features/admin/ui";

interface PoolApi {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  maxConcurrency: number;
  enabled: boolean;
  apiKeyMasked: string;
  hasKey: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EnvApi {
  id: string;
  slot: number;
  baseUrl: string;
  model: string;
  maxConcurrency: number;
  apiKeyMasked: string;
  ready: boolean;
}

interface PoolData {
  apis: PoolApi[];
  envApis: EnvApi[];
}

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<PoolData>(request, "/api/admin/llm-apis");
}

export const meta: Route.MetaFunction = () => [{ title: `LLM API Pool · ${SITE.name} 后台` }];

interface Draft {
  id: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxConcurrency: string;
}

const emptyDraft: Draft = { id: null, name: "", baseUrl: "", apiKey: "", model: "", maxConcurrency: "2" };

export default function LlmPoolAdmin({ loaderData: data }: Route.ComponentProps) {
  const { run, busy } = useAdminAction();
  const me = useAdminMe();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<PoolApi | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.baseUrl.trim() || !draft.model.trim()) {
      toast("Base URL 和模型必填", "error");
      return false;
    }
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      maxConcurrency: Number.parseInt(draft.maxConcurrency, 10) || 1,
    };
    if (draft.id) {
      if (draft.apiKey.trim()) payload.apiKey = draft.apiKey.trim();
      if (!(await run("PATCH", `/api/admin/llm-apis/${draft.id}`, payload, { label: "update-api", success: "已保存，几秒内生效" }))) return false;
    } else {
      if (!draft.apiKey.trim()) {
        toast("API Key 必填", "error");
        return false;
      }
      payload.apiKey = draft.apiKey.trim();
      if (!(await run("POST", "/api/admin/llm-apis", payload, { label: "create-api", success: "已添加，几秒内生效" }))) return false;
    }
    setDraft(null);
  };

  const testDraft = async () => {
    if (!draft) return;
    setTesting("draft");
    try {
      const res = await fetch("/api/admin/llm-apis/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": me.csrf },
        body: JSON.stringify({ id: draft.id, baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() || undefined, model: draft.model.trim() }),
      }).then((r) => r.json() as Promise<{ ok: boolean; latencyMs: number; detail?: string; model?: string }>);
      if (res.ok) toast(`连接成功（${res.latencyMs} ms）${res.detail ? `：${res.detail}` : ""}`, "ok");
      else toast(`连接失败：${res.detail ?? "未知错误"}`, "error");
    } catch {
      toast("网络错误，请稍后再试", "error");
    } finally {
      setTesting(null);
    }
  };

  const testSaved = async (api: PoolApi) => {
    setTesting(api.id);
    const res = await run<{ ok: boolean; latencyMs: number; detail?: string; model?: string }>("POST", `/api/admin/llm-apis/${api.id}/test`, undefined, { label: `test-${api.id}`, revalidate: false });
    setTesting(null);
    if (res) {
      if (res.ok) toast(`${api.name} 连接成功（${res.latencyMs} ms）${res.detail ? `：${res.detail}` : ""}`, "ok");
      else toast(`${api.name} 连接失败：${res.detail ?? "未知错误"}`, "error");
    }
  };

  return (
    <AdminPage
      title="LLM API Pool"
      subtitle="自定义 OpenAI 兼容接口池（/chat/completions）。多个端点轮询分流，失败自动冷却 60 秒；保存或停用约 5 秒内在所有进程生效，无需重启。API Key 只保存在服务器，不会回显。"
      actions={
        <Button tone="primary" onClick={() => setDraft({ ...emptyDraft })}>
          添加 API
        </Button>
      }
    >
      <div className="grid gap-5">
        <Card title="自定义端点" pad={false}>
          {data.apis.length ? (
            <DataTable
              rows={data.apis}
              rowKey={(a) => a.id}
              columns={[
                {
                  key: "n",
                  label: "名称",
                  render: (a) => (
                    <span className="flex flex-col">
                      <span className="font-medium">{a.name}</span>
                      <span className="font-mono text-[11.5px] text-ink-3">{a.apiKeyMasked}</span>
                    </span>
                  ),
                },
                { key: "u", label: "Base URL", render: (a) => <span className="font-mono text-[11.5px]">{a.baseUrl}</span> },
                { key: "m", label: "模型", render: (a) => <span className="font-mono text-[12px]">{a.model}</span> },
                { key: "c", label: "并发", align: "right", render: (a) => a.maxConcurrency },
                {
                  key: "s",
                  label: "状态",
                  render: (a) => <Badge tone={a.enabled ? "ok" : "muted"}>{a.enabled ? "启用" : "停用"}</Badge>,
                },
                {
                  key: "a",
                  label: "操作",
                  align: "right",
                  render: (a) => (
                    <span className="flex justify-end gap-1.5">
                      <Button size="sm" tone="secondary" busy={testing === a.id} onClick={() => testSaved(a)}>
                        测试
                      </Button>
                      <Button
                        size="sm"
                        tone="secondary"
                        onClick={() =>
                          setDraft({ id: a.id, name: a.name, baseUrl: a.baseUrl, apiKey: "", model: a.model, maxConcurrency: String(a.maxConcurrency) })
                        }
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        tone="secondary"
                        onClick={async () => {
                          await run("PATCH", `/api/admin/llm-apis/${a.id}`, { enabled: !a.enabled }, { label: `toggle-${a.id}`, success: a.enabled ? "已停用" : "已启用" });
                        }}
                      >
                        {a.enabled ? "停用" : "启用"}
                      </Button>
                      <Button size="sm" tone="danger" onClick={() => setDeleting(a)}>
                        删除
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
          ) : (
            <Empty>还没有添加端点。点右上角「添加 API」，填 OpenAI 兼容的 Base URL、API Key 和模型名。</Empty>
          )}
        </Card>

        <Card title="环境变量槽位（只读）" subtitle="来自 .env 的 LLM_API_N_* 配置，不能在这里修改；留空的槽位不会启用。">
          {data.envApis.length ? (
            <DataTable
              dense
              rows={data.envApis}
              rowKey={(e) => e.id}
              columns={[
                { key: "s", label: "槽位", render: (e) => `LLM_API_${e.slot}_*` },
                { key: "u", label: "Base URL", render: (e) => <span className="font-mono text-[11.5px]">{e.baseUrl || "—"}</span> },
                { key: "m", label: "模型", render: (e) => <span className="font-mono text-[12px]">{e.model || "—"}</span> },
                { key: "c", label: "并发", align: "right", render: (e) => e.maxConcurrency },
                { key: "k", label: "Key", render: (e) => <span className="font-mono text-[11.5px]">{e.apiKeyMasked}</span> },
                { key: "r", label: "就绪", render: (e) => <Badge tone={e.ready ? "ok" : "muted"}>{e.ready ? "会启用" : "跳过"}</Badge> },
              ]}
            />
          ) : (
            <Empty>.env 里没有 LLM_API_N_* 槽位</Empty>
          )}
        </Card>
      </div>

      <ReasonDialog
        open={!!draft}
        title={draft?.id ? `编辑 API：${draft.name || draft.model}` : "添加 API 端点"}
        description="任何 OpenAI 兼容接口都可以，例如 https://api.deepseek.com/v1。Key 保存后只显示掩码；编辑时留空表示保持原 Key。"
        confirmLabel={draft?.id ? "保存" : "添加"}
        requireReason={false}
        busy={busy}
        onClose={() => setDraft(null)}
        onSubmit={save}
      >
        <Field label="名称（可选，默认用模型名）">
          <Input value={draft?.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="DeepSeek 主力" />
        </Field>
        <Field label="Base URL（OpenAI 兼容，不含 /chat/completions）">
          <Input value={draft?.baseUrl ?? ""} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
        </Field>
        <Field label={draft?.id ? "API Key（留空保持不变）" : "API Key"}>
          <Input value={draft?.apiKey ?? ""} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" />
        </Field>
        <Field label="模型名">
          <Input value={draft?.model ?? ""} onChange={(e) => set({ model: e.target.value })} placeholder="deepseek-chat" />
        </Field>
        <Field label="最大并发（1-64）">
          <Input value={draft?.maxConcurrency ?? "2"} onChange={(e) => set({ maxConcurrency: e.target.value })} inputMode="numeric" />
        </Field>
        <div className="flex justify-end">
          <Button size="sm" tone="secondary" busy={testing === "draft"} onClick={testDraft}>
            测试连接
          </Button>
        </div>
      </ReasonDialog>

      <ReasonDialog
        open={!!deleting}
        title={`删除 API：${deleting?.name ?? ""}`}
        description="删除后池会立即少一个端点；正在用它的请求不受影响。"
        confirmLabel="删除"
        danger
        busy={busy}
        onClose={() => setDeleting(null)}
        onSubmit={async (reason) => (await run("DELETE", `/api/admin/llm-apis/${deleting!.id}`, { reason }, { label: "delete-api", success: "已删除" })) !== null}
      />
    </AdminPage>
  );
}
