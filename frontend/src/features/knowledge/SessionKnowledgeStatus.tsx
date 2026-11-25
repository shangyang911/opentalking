import { knowledgeSettingsChanged, type KnowledgeSettings } from "./config";

type Props = {
  applied: KnowledgeSettings | null;
  selectedIds: string[];
  memoryEnabled: boolean;
  live: boolean;
  onManage: () => void;
  onReconnect: () => void;
  reconnectDisabled?: boolean;
  reconnectReason?: string;
  managementLabel?: string;
};

export function SessionKnowledgeStatus({ applied, selectedIds, memoryEnabled, live, onManage, onReconnect, reconnectDisabled, reconnectReason, managementLabel = "管理资料与记忆" }: Props) {
  const current = live ? applied : { ids: selectedIds, memoryEnabled };
  const changed = live && applied !== null && knowledgeSettingsChanged(applied, selectedIds, memoryEnabled);
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p>{live ? "本次对话：" : "下次对话："}{current ? current.ids.length ? `参考 ${current.ids.length} 组资料` : "未启用资料" : "正在确认设置"}{current && <> · {current.memoryEnabled ? "个人记忆已开启" : "个人记忆未开启"}</>}</p>
      <button type="button" onClick={onManage} className="font-medium text-cyan-700 underline">{managementLabel}</button>
    </div>
    {changed && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
      <p>设置已保存，重新连接后生效</p>
      <button type="button" disabled={reconnectDisabled} title={reconnectReason} onClick={onReconnect} className="font-semibold text-cyan-700 underline disabled:cursor-not-allowed disabled:text-slate-400">重新连接并应用</button>
      {reconnectDisabled && reconnectReason && <p className="w-full text-slate-500">{reconnectReason}</p>}
    </div>}
  </div>;
}
