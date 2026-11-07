import { Link } from "@tanstack/react-router";
import { FolderPlus, Settings, Terminal } from "lucide-react";
import { Button, Card, EmptyState } from "./ui";

export function EmptySources() {
  return (
    <EmptyState
      title="还没有安装内容源"
      icon={<FolderPlus className="size-10" aria-hidden="true" />}
      description={
        <>
          ComicSpace 不内置任何漫画站点。把写好的插件文件夹放进仓库的{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">
            plugins/
          </code>{" "}
          目录，然后到设置页点击重新加载。
        </>
      }
    >
      <div className="grid gap-3 text-left sm:grid-cols-3">
        <Card>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Terminal className="size-4 text-accent" /> 1. 创建插件
          </div>
          <p className="text-xs leading-5 text-muted">
            运行{" "}
            <code className="text-ink">pnpm plugin:new my-source</code>{" "}
            复制模板，或直接把已有插件文件夹放进{" "}
            <code className="text-ink">plugins/</code>。
          </p>
        </Card>
        <Card>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Settings className="size-4 text-accent" /> 2. 重载与配置
          </div>
          <p className="text-xs leading-5 text-muted">
            在设置页重载插件；如果 manifest 声明了 API Key、Cookie 等配置，填写后保存。
          </p>
        </Card>
        <Card>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <FolderPlus className="size-4 text-accent" /> 3. 开始阅读
          </div>
          <p className="text-xs leading-5 text-muted">
            源就绪后，首页会出现浏览信息流；也可以直接搜索并加入书架。
          </p>
        </Card>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link to="/settings">
          <Button variant="primary">打开设置</Button>
        </Link>
        <span className="text-xs text-muted">
          插件文档：仓库中的 <code className="text-ink">docs/PLUGIN_AUTHORING.md</code>
        </span>
      </div>
      <p className="mt-5 max-w-2xl text-xs leading-5 text-muted">
        请只接入你有权访问的 API/内容，并遵守来源站条款与当地法律。ComicSpace
        不提供绕过付费墙或 DRM 的功能。
      </p>
    </EmptyState>
  );
}
