interface Part {
  id: string;
  name: string;
  type: "base" | "joint" | "gripper";
  parentId: string | null;
  childrenIds: string[];
  position: [number, number, number];
  rotation: [number, number, number];
  rotationAxis: [number, number, number];
  axisLength: number;
  axisColor: string;
  axisVisible: boolean;
  gripperMultiplier?: number;
}

import { Edit2 } from "lucide-react";
import { SerialBindings } from "../types/serial";

interface SerialBindingPanelProps {
  parts: Part[];
  serialBindings: SerialBindings;
  onBindingChange: (bindings: SerialBindings) => void;
}

/**
 * 串口关节绑定配置面板
 * 允许为每个 Joint 类型的部件绑定到串口数据字段（如 J1、J2）
 */
export function SerialBindingPanel({
  parts,
  serialBindings,
  onBindingChange,
}: SerialBindingPanelProps) {
  const joints = parts.filter((p) => p.type === "joint");

  const handleFieldChange = (partId: string, fieldName: string) => {
    const newBindings = { ...serialBindings };

    if (!fieldName || fieldName.trim() === "") {
      // 删除绑定
      delete newBindings[partId];
    } else {
      // 添加或更新绑定
      newBindings[partId] = fieldName.trim().toUpperCase();
    }

    onBindingChange(newBindings);
  };

  return (
    <div className="rounded-xl border border-slate-200 p-3 mb-3">
      <h3 className="text-[12px] font-semibold mb-3 flex items-center gap-2 text-slate-700">
        <Edit2 className="h-4 w-4" />
        关节字段绑定
      </h3>

      {joints.length === 0 ? (
        <div className="text-[11px] text-slate-500 text-center py-4">
          <p>暂无关节部件</p>
          <p className="text-[10px] opacity-75">请先添加关节</p>
        </div>
      ) : (
        <div className="space-y-2">
          {joints.map((joint) => (
            <div key={joint.id} className="flex items-center gap-2">
              {/* 关节名称 */}
              <div className="flex-1 min-w-0">
                <label className="text-[11px] font-medium text-slate-700 block truncate">
                  {joint.name}
                </label>
              </div>

              {/* 字段名输入框 */}
              <input
                type="text"
                value={serialBindings[joint.id] || ""}
                onChange={(e) => handleFieldChange(joint.id, e.target.value)}
                placeholder="J1"
                className="w-16 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-mono focus:outline-none focus:border-blue-400"
              />
            </div>
          ))}
        </div>
      )}

      {/* 帮助文字 */}
      <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 p-2 text-[10px] text-blue-700">
        <p className="font-medium mb-1">💡 如何绑定</p>
        <ul className="space-y-0.5 text-[9px] text-blue-600">
          <li>• 输入串口数据中的字段名（如 J1、J2 等）</li>
          <li>• 每个关节最多绑定一个字段</li>
          <li>• 留空表示不绑定该关节</li>
        </ul>
      </div>
    </div>
  );
}
