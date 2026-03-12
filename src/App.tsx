import { useRef, useState, useMemo, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Line, Html } from "@react-three/drei";
import * as THREE from "three";
import {
  Plus, RotateCw, Link2, Settings, ChevronDown, ChevronRight,
  Grip, Box, CircleDot, Trash2, Download, Upload, Eye
} from "lucide-react";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────
type PartType = "base" | "joint" | "gripper";

interface Part {
  id: string;
  name: string;
  type: PartType;
  parentId: string | null;
  childrenIds: string[];
  position: [number, number, number];
  /**
   * rotation 含义：
   *  - base:    rotation[1] = 绕 Y 轴旋转角度（°），范围 -180~180
   *  - joint:   rotation[0] = 沿自定义旋转轴的旋转角度（0–180°）
   *  - gripper: rotation[0] = 夹爪张开角度（°），由面板直接控制
   */
  rotation: [number, number, number];
  rotationAxis: [number, number, number]; // 关节自定义旋转轴（单位向量）
  axisLength: number;
  axisColor: string;
  axisVisible: boolean;
  gripperMultiplier?: number; // 夹爪张开倍数：父关节轴旋转 X° → 夹爪开 multiplier*X°
}

interface ArmConfig {
  parts: Part[];
  selectedPartId: string | null;
}

// ─── 常量 ──────────────────────────────────────────────────────────────────────
const PART_COLORS: Record<PartType, string> = {
  base: "#8B5CF6",
  joint: "#3B82F6",
  gripper: "#10B981",
};
const PART_SIZES: Record<PartType, number> = {
  base: 0.18,
  joint: 0.014,   // 关节球体大小
  gripper: 0.05,
};

let idCounter = 0;
const genId = (type: PartType) => `${type}-${++idCounter}`;

const normalizeVector = (v: [number, number, number]): [number, number, number] => {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  return len < 1e-6 ? [0, 1, 0] : [v[0] / len, v[1] / len, v[2] / len];
};

const positionLength = (pos: [number, number, number]) =>
  Math.sqrt(pos[0] ** 2 + pos[1] ** 2 + pos[2] ** 2);

const scalePosition = (
  pos: [number, number, number],
  distance: number
): [number, number, number] => {
  const v = new THREE.Vector3(...pos);
  if (v.length() < 1e-4) v.set(0, 1, 0);
  v.normalize().multiplyScalar(distance);
  return [v.x, v.y, v.z];
};

// ─── 世界变换计算 ──────────────────────────────────────────────────────────────
/**
 * 递归计算每个部件的世界变换（位置 + 四元数）。
 * - base:    绕 Y 轴旋转 rotation[1]°
 * - joint:   沿 rotationAxis 旋转 rotation[0]°（0–180°）
 * - gripper: 无自身旋转（夹爪指由 rotation[0] 驱动，但不影响链变换）
 */
const calculateWorldTransforms = (parts: Part[]) => {
  const partMap = new Map(parts.map((p) => [p.id, p]));
  const worldPosition = new Map<string, THREE.Vector3>();
  const worldQuaternion = new Map<string, THREE.Quaternion>();
  const root = parts.find((p) => p.parentId === null);
  if (!root) return { worldPosition, worldQuaternion };

  const dfs = (partId: string, parentMatrix: THREE.Matrix4) => {
    const part = partMap.get(partId);
    if (!part) return;

    const localPos = new THREE.Vector3(...part.position);
    let localQuat = new THREE.Quaternion();

    if (part.type === "joint") {
      // 关节：沿自定义轴旋转 rotation[0]°（0–180°）
      const axis = new THREE.Vector3(...part.rotationAxis).normalize();
      const angleRad = (part.rotation[0] * Math.PI) / 180;
      localQuat.setFromAxisAngle(axis, angleRad);
    } else if (part.type === "base") {
      // 底盘：绕 Y 轴旋转 rotation[1]°
      const yAxis = new THREE.Vector3(0, 1, 0);
      localQuat.setFromAxisAngle(yAxis, (part.rotation[1] * Math.PI) / 180);
    }
    // gripper: 不参与链变换（夹爪张开角只影响手指渲染）

    const localMatrix = new THREE.Matrix4()
      .makeRotationFromQuaternion(localQuat)
      .setPosition(localPos);

    const worldMatrix = parentMatrix.clone().multiply(localMatrix);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    worldMatrix.decompose(pos, quat, scale);

    worldPosition.set(partId, pos);
    worldQuaternion.set(partId, quat);

    part.childrenIds.forEach((childId) => dfs(childId, worldMatrix));
  };

  dfs(root.id, new THREE.Matrix4());
  return { worldPosition, worldQuaternion };
};

// ─── 旋转轴箭头组件（手动用 Line + 锥体实现，兼容 R3F） ──────────────────────
function AxisArrow({
  direction,
  length,
  color,
}: {
  direction: [number, number, number];
  length: number;
  color: string;
}) {
  const dir = new THREE.Vector3(...direction).normalize();
  const tip = dir.clone().multiplyScalar(length);
  const shaftEnd = dir.clone().multiplyScalar(length * 0.82);

  // 计算锥体朝向的四元数（coneGeometry 默认朝 +Y）
  const up = new THREE.Vector3(0, 1, 0);
  const coneQuat = new THREE.Quaternion().setFromUnitVectors(up, dir);

  return (
    <group>
      {/* 轴线 */}
      <Line
        points={[new THREE.Vector3(0, 0, 0), shaftEnd]}
        color={color}
        lineWidth={2.5}
      />
      {/* 箭头锥体 */}
      <mesh position={tip} quaternion={coneQuat}>
        <coneGeometry args={[0.025, length * 0.18, 10]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

// ─── 夹爪动画组件（使用 useFrame 做平滑插值） ─────────────────────────────────
function GripperMesh({
  openAngleDeg,
  color,
  isSelected,
  onClick,
}: {
  openAngleDeg: number;
  color: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  // 用 ref 存储当前渲染角度，做平滑动画
  const leftRef = useRef<THREE.Group>(null);
  const rightRef = useRef<THREE.Group>(null);
  const targetAngleRef = useRef(0);
  const currentAngleRef = useRef(0);

  // 目标角度 = 总开角的一半（每片各旋转一半）
  targetAngleRef.current = (openAngleDeg * Math.PI) / 180 / 2;

  useFrame((_, delta) => {
    // lerp 速度系数：越大越快，6 为中等流畅
    const speed = 6;
    currentAngleRef.current = THREE.MathUtils.lerp(
      currentAngleRef.current,
      targetAngleRef.current,
      Math.min(1, delta * speed * 60)
    );
    const a = currentAngleRef.current;
    if (leftRef.current) leftRef.current.rotation.z = a;
    if (rightRef.current) rightRef.current.rotation.z = -a;
  });

  return (
    <group onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {/* 夹爪根节点小球 */}
      <mesh>
        <sphereGeometry args={[PART_SIZES.gripper, 20, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={isSelected ? color : "#000"}
          emissiveIntensity={isSelected ? 0.35 : 0}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>

      {/* 左指（绕 Z 轴正向张开） */}
      <group ref={leftRef}>
        {/* 指杆 */}
        <mesh position={[0, 0.13, 0]}>
          <boxGeometry args={[0.032, 0.24, 0.038]} />
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.7} />
        </mesh>
        {/* 指尖锥 */}
        <mesh position={[0, 0.265, 0]}>
          <coneGeometry args={[0.016, 0.058, 8]} />
          <meshStandardMaterial color="#065f46" roughness={0.3} metalness={0.7} />
        </mesh>
      </group>

      {/* 右指（绕 Z 轴负向张开） */}
      <group ref={rightRef}>
        <mesh position={[0, 0.13, 0]}>
          <boxGeometry args={[0.032, 0.24, 0.038]} />
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0.265, 0]}>
          <coneGeometry args={[0.016, 0.058, 8]} />
          <meshStandardMaterial color="#065f46" roughness={0.3} metalness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState<ArmConfig>(() => {
    const baseId = genId("base");
    const j1 = genId("joint");
    const j2 = genId("joint");
    const j3 = genId("joint");
    const g = genId("gripper");
    return {
      selectedPartId: j1,
      parts: [
        {
          id: baseId, name: "底盘基座", type: "base",
          parentId: null, childrenIds: [j1],
          position: [0, 0, 0], rotation: [0, 0, 0],
          rotationAxis: [0, 1, 0], axisLength: 0.6, axisColor: "#8B5CF6", axisVisible: true,
        },
        {
          id: j1, name: "关节 1", type: "joint",
          parentId: baseId, childrenIds: [j2],
          position: [0, 0.4, 0], rotation: [0, 0, 0],
          rotationAxis: [0, 1, 0], axisLength: 0.55, axisColor: "#3B82F6", axisVisible: true,
        },
        {
          id: j2, name: "关节 2", type: "joint",
          parentId: j1, childrenIds: [j3],
          position: [0, 0.35, 0], rotation: [0, 0, 0],
          rotationAxis: [1, 0, 0], axisLength: 0.5, axisColor: "#06B6D4", axisVisible: true,
        },
        {
          id: j3, name: "关节 3", type: "joint",
          parentId: j2, childrenIds: [g],
          position: [0, 0.3, 0], rotation: [0, 0, 0],
          rotationAxis: [0, 0, 1], axisLength: 0.45, axisColor: "#8B5CF6", axisVisible: true,
        },
        {
          id: g, name: "夹爪", type: "gripper",
          parentId: j3, childrenIds: [],
          position: [0, 0.25, 0], rotation: [0, 0, 0],
          rotationAxis: [0, 1, 0], axisLength: 0, axisColor: "#10B981", axisVisible: false,
          gripperMultiplier: 2,
        },
      ],
    };
  });

  const [showLinks, setShowLinks] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => config.parts.find((p) => p.id === config.selectedPartId) || null,
    [config]
  );
  const { worldPosition, worldQuaternion } = useMemo(
    () => calculateWorldTransforms(config.parts),
    [config.parts]
  );

  // ── 添加部件 ─────────────────────────────────────────────────────────────────
  const addPart = useCallback(
    (type: PartType) => {
      const parent = config.selectedPartId
        ? config.parts.find((p) => p.id === config.selectedPartId)
        : null;
      if (type !== "base" && !parent) return alert("请先选择父部件或创建底盘");
      if (parent?.type === "gripper") return alert("夹爪不能有子部件");

      const newId = genId(type);
      const newPart: Part = {
        id: newId,
        name: `${type === "base" ? "底盘" : type === "joint" ? "关节" : "夹爪"} ${idCounter}`,
        type,
        parentId: parent?.id || null,
        childrenIds: [],
        position: [0, parent ? 0.3 : 0, 0],
        rotation: [0, 0, 0],
        rotationAxis: [0, 1, 0],
        axisLength: type === "joint" ? 0.5 : 0,
        axisColor: PART_COLORS[type],
        axisVisible: type === "joint",
        ...(type === "gripper" ? { gripperMultiplier: 2 } : {}),
      };

      setConfig((prev) => {
        const parts = [...prev.parts, newPart];
        if (parent) {
          const idx = parts.findIndex((p) => p.id === parent.id);
          parts[idx] = { ...parts[idx], childrenIds: [...parts[idx].childrenIds, newId] };
        }
        return { parts, selectedPartId: newId };
      });
      if (parent) setExpanded((prev) => new Set(prev).add(parent.id));
    },
    [config]
  );

  const updatePart = useCallback((id: string, updates: Partial<Part>) => {
    setConfig((prev) => ({
      ...prev,
      parts: prev.parts.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  }, []);

  const deletePart = useCallback((id: string) => {
    setConfig((prev) => {
      const toDelete = new Set<string>([id]);
      const collect = (pid: string) => {
        const p = prev.parts.find((x) => x.id === pid);
        p?.childrenIds.forEach((cid) => { toDelete.add(cid); collect(cid); });
      };
      collect(id);
      const remaining = prev.parts.filter((p) => !toDelete.has(p.id));
      const deletedPart = prev.parts.find((p) => p.id === id);
      if (deletedPart?.parentId) {
        const pidx = remaining.findIndex((p) => p.id === deletedPart.parentId);
        if (pidx >= 0)
          remaining[pidx] = {
            ...remaining[pidx],
            childrenIds: remaining[pidx].childrenIds.filter((cid) => cid !== id),
          };
      }
      const newSel = toDelete.has(prev.selectedPartId || "")
        ? deletedPart?.parentId || remaining[0]?.id || null
        : prev.selectedPartId;
      return { parts: remaining, selectedPartId: newSel };
    });
  }, []);

  const exportConfig = useCallback(() => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arm-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  const importConfig = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.parts) setConfig(data);
      } catch { alert("无效的配置文件"); }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── 关节旋转角度变更（0–180°） ───────────────────────────────────────────────
  const updateJointAngle = useCallback(
    (id: string, angleDeg: number) => {
      const clamped = Math.max(0, Math.min(180, angleDeg));
      updatePart(id, { rotation: [clamped, 0, 0] });
    },
    [updatePart]
  );

  // ── 底盘 Y 轴旋转变更（-180–180°） ──────────────────────────────────────────
  const updateBaseYAngle = useCallback(
    (id: string, angleDeg: number) => {
      const clamped = Math.max(-180, Math.min(180, angleDeg));
      updatePart(id, { rotation: [0, clamped, 0] });
    },
    [updatePart]
  );

  // ── 夹爪开合角直接更新（0–180°） ────────────────────────────────────────────
  const updateGripperAngle = useCallback(
    (id: string, angleDeg: number) => {
      const clamped = Math.max(0, Math.min(180, angleDeg));
      updatePart(id, { rotation: [clamped, 0, 0] });
    },
    [updatePart]
  );

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen flex-col bg-[#f8fafc] font-sans antialiased">
      {/* ── Header ── */}
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Grip className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-slate-800">机械臂 3D 可视化</h1>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Designer</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => addPart("base")} className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50" title="添加底盘"><Plus className="h-4 w-4" /></button>
          <button onClick={() => addPart("joint")} disabled={!config.selectedPartId} className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50 disabled:opacity-40" title="添加关节"><CircleDot className="h-4 w-4" /></button>
          <button onClick={() => addPart("gripper")} disabled={!config.selectedPartId} className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50 disabled:opacity-40" title="添加夹爪"><Grip className="h-4 w-4" /></button>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <button onClick={() => setShowLinks(!showLinks)} className={`h-8 w-8 rounded-lg border flex items-center justify-center ${showLinks ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-600"}`} title="显示/隐藏连接线"><Eye className="h-4 w-4" /></button>
          <button onClick={() => fileInputRef.current?.click()} className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50" title="导入配置"><Upload className="h-4 w-4" /></button>
          <button onClick={exportConfig} className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50" title="导出配置"><Download className="h-4 w-4" /></button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={importConfig} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel: 部件结构树 ── */}
        <aside className="w-[270px] border-r border-slate-200 bg-white flex flex-col">
          <div className="border-b border-slate-200 p-3">
            <h2 className="text-[13px] font-semibold text-slate-700 flex items-center gap-2">
              <Box className="h-4 w-4" />部件结构
            </h2>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {config.parts
              .filter((p) => !p.parentId)
              .map((root) =>
                renderTree(root, config.parts, 0, config.selectedPartId,
                  (id) => setConfig((prev) => ({ ...prev, selectedPartId: id })),
                  deletePart, expanded, setExpanded)
              )}
          </div>
        </aside>

        {/* ── Canvas: 3D 视图 ── */}
        <main className="flex-1 relative">
          <Canvas
            camera={{ position: [4, 3, 4], fov: 50 }}
            onPointerMissed={() => setConfig((prev) => ({ ...prev, selectedPartId: null }))}
          >
            <color attach="background" args={["#f8fafc"]} />
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 8, 5]} intensity={1} />
            <directionalLight position={[-3, 4, -3]} intensity={0.4} />

            {/* 网格 */}
            <Grid infiniteGrid cellSize={0.5} sectionSize={2.5} fadeDistance={30} cellColor="#e2e8f0" />

            {/* 世界坐标轴 */}
            <Line points={[new THREE.Vector3(0,0,0), new THREE.Vector3(2,0,0)]} color="#ef4444" lineWidth={2} />
            <Line points={[new THREE.Vector3(0,0,0), new THREE.Vector3(0,2,0)]} color="#22c55e" lineWidth={2} />
            <Line points={[new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,2)]} color="#3b82f6" lineWidth={2} />

            {/* 连接线 */}
            {showLinks &&
              config.parts.map((p) => {
                if (!p.parentId) return null;
                const a = worldPosition.get(p.parentId);
                const b = worldPosition.get(p.id);
                return a && b ? (
                  <Line key={p.id} points={[a, b]} color="#94a3b8" lineWidth={2} dashed dashSize={0.1} gapSize={0.05} />
                ) : null;
              })}

            {/* ── 部件渲染 ── */}
            {config.parts.map((p) => {
              const pos = worldPosition.get(p.id);
              const quat = worldQuaternion.get(p.id);
              if (!pos) return null;

              // 夹爪开合角 = rotation[0]（已由面板直接控制）
              const gripperOpenDeg = p.rotation[0];

              return (
                <group key={p.id} position={pos} quaternion={quat}>

                  {/* ── 旋转轴箭头（关节 & 底盘） ── */}
                  {p.axisVisible && p.axisLength > 0 && (
                    <AxisArrow
                      direction={p.type === "base" ? [0, 1, 0] : p.rotationAxis}
                      length={p.axisLength}
                      color={p.axisColor}
                    />
                  )}

                  {/* ── 关节 / 底盘：小球 ── */}
                  {p.type !== "gripper" ? (
                    <>
                      <mesh
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfig((prev) => ({ ...prev, selectedPartId: p.id }));
                        }}
                      >
                        <sphereGeometry args={[PART_SIZES[p.type], 20, 20]} />
                        <meshStandardMaterial
                          color={PART_COLORS[p.type]}
                          emissive={config.selectedPartId === p.id ? PART_COLORS[p.type] : "#000"}
                          emissiveIntensity={config.selectedPartId === p.id ? 0.35 : 0}
                        />
                      </mesh>

                      {/* 标签 */}
                      <Html distanceFactor={10} style={{ pointerEvents: "none" }}>
                        <div
                          style={{
                            background: "rgba(0,0,0,0.58)",
                            color: "#fff",
                            fontSize: "6px",
                            padding: "1px 3px",
                            borderRadius: "3px",
                            whiteSpace: "nowrap",
                            lineHeight: "1.4",
                          }}
                        >
                          {p.name}
                        </div>
                      </Html>
                    </>
                  ) : (
                    /* ── 夹爪：V 字形带平滑动画 ── */
                    <>
                      <GripperMesh
                        openAngleDeg={gripperOpenDeg}
                        color={PART_COLORS.gripper}
                        isSelected={config.selectedPartId === p.id}
                        onClick={() => setConfig((prev) => ({ ...prev, selectedPartId: p.id }))}
                      />
                      {/* 夹爪标签 */}
                      <Html distanceFactor={10} style={{ pointerEvents: "none" }}>
                        <div
                          style={{
                            background: "rgba(16,185,129,0.75)",
                            color: "#fff",
                            fontSize: "6px",
                            padding: "1px 3px",
                            borderRadius: "3px",
                            whiteSpace: "nowrap",
                            lineHeight: "1.4",
                          }}
                        >
                          {p.name}
                        </div>
                      </Html>
                    </>
                  )}
                </group>
              );
            })}

            <OrbitControls enableDamping minDistance={1.5} maxDistance={12} />
          </Canvas>

          <div className="absolute bottom-4 left-4 bg-white/80 backdrop-blur rounded-xl border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
            🖱️ 拖拽旋转 · 🔍 滚轮缩放
          </div>
        </main>

        {/* ── Right Panel: 属性面板 ── */}
        <aside className="w-[310px] border-l border-slate-200 bg-white flex flex-col">
          <div className="border-b border-slate-200 p-4">
            <h2 className="text-[13px] font-semibold text-slate-700 flex items-center gap-2">
              <Settings className="h-4 w-4" />属性
            </h2>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {selected ? (
              <div className="space-y-4">

                {/* 名称 */}
                <div className="rounded-xl border border-slate-200 p-3">
                  <input
                    value={selected.name}
                    onChange={(e) => updatePart(selected.id, { name: e.target.value })}
                    className="w-full text-[15px] font-semibold bg-transparent border-0 outline-none"
                  />
                  <div className="text-[10px] text-slate-400 mt-1">{selected.id}</div>
                </div>

                {/* ══ 关节：沿旋转轴单轴旋转（0–180°） ══ */}
                {selected.type === "joint" && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                    <h3 className="text-[12px] font-semibold mb-1 flex items-center gap-2 text-violet-800">
                      <RotateCw className="h-3.5 w-3.5" />
                      沿旋转轴旋转
                    </h3>
                    <p className="text-[10px] text-violet-500 mb-3">
                      旋转轴方向：({selected.rotationAxis.map(v => v.toFixed(2)).join(", ")})
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] text-slate-500 w-20">角度 (°)</span>
                      <input
                        type="number"
                        step={1}
                        min={0}
                        max={180}
                        value={selected.rotation[0].toFixed(1)}
                        onChange={(e) => updateJointAngle(selected.id, parseFloat(e.target.value) || 0)}
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] font-mono text-center"
                      />
                      <span className="text-[11px] text-slate-400 font-mono w-10 text-right">
                        {selected.rotation[0].toFixed(1)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={180}
                      step={0.5}
                      value={selected.rotation[0]}
                      onChange={(e) => updateJointAngle(selected.id, parseFloat(e.target.value))}
                      className="w-full accent-violet-500 h-2"
                    />
                    <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                      <span>0°</span><span>90°</span><span>180°</span>
                    </div>
                  </div>
                )}

                {/* ══ 底盘：绕 Y 轴旋转（-180–180°） ══ */}
                {selected.type === "base" && (
                  <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-3">
                    <h3 className="text-[12px] font-semibold mb-1 flex items-center gap-2 text-purple-800">
                      <RotateCw className="h-3.5 w-3.5" />
                      底盘绕 Y 轴旋转
                    </h3>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] text-slate-500 w-20">角度 (°)</span>
                      <input
                        type="number"
                        step={1}
                        min={-180}
                        max={180}
                        value={selected.rotation[1].toFixed(1)}
                        onChange={(e) => updateBaseYAngle(selected.id, parseFloat(e.target.value) || 0)}
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] font-mono text-center"
                      />
                      <span className="text-[11px] text-slate-400 font-mono w-10 text-right">
                        {selected.rotation[1].toFixed(1)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={0.5}
                      value={selected.rotation[1]}
                      onChange={(e) => updateBaseYAngle(selected.id, parseFloat(e.target.value))}
                      className="w-full accent-purple-500 h-2"
                    />
                    <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                      <span>-180°</span><span>0°</span><span>180°</span>
                    </div>
                  </div>
                )}

                {/* ══ 夹爪：直接控制张开角度 ══ */}
                {selected.type === "gripper" && (() => {
                  const openAngle = selected.rotation[0];   // 直接存在 rotation[0]
                  const mult = selected.gripperMultiplier ?? 2;
                  // 找父关节：如果父关节的轴角度也会影响夹爪，则显示连动提示
                  const parentPart = selected.parentId
                    ? config.parts.find((p) => p.id === selected.parentId)
                    : null;

                  return (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
                      <h3 className="text-[12px] font-semibold flex items-center gap-2 text-emerald-800">
                        <Grip className="h-3.5 w-3.5" />夹爪张开控制
                      </h3>

                      {/* 状态展示 */}
                      <div className="bg-white rounded-lg border border-emerald-200 p-2 text-[11px] space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-500">夹爪张开角度</span>
                          <span className="font-mono font-semibold text-emerald-700">{openAngle.toFixed(1)}°</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">状态</span>
                          <span className={`font-semibold ${openAngle > 5 ? "text-emerald-600" : "text-rose-600"}`}>
                            {openAngle > 5 ? `张开 ${openAngle.toFixed(1)}°` : "夹紧"}
                          </span>
                        </div>
                      </div>

                      {/* 夹爪张开角度滑块（直接控制） */}
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1 font-medium">
                          张开角度（0° = 夹紧，180° = 全开）
                        </label>
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="number"
                            step={1}
                            min={0}
                            max={180}
                            value={openAngle.toFixed(1)}
                            onChange={(e) => updateGripperAngle(selected.id, parseFloat(e.target.value) || 0)}
                            className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] font-mono text-center"
                          />
                          <span className="text-[11px] text-slate-400 font-mono w-10 text-right">
                            {openAngle.toFixed(1)}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={180}
                          step={0.5}
                          value={openAngle}
                          onChange={(e) => updateGripperAngle(selected.id, parseFloat(e.target.value))}
                          className="w-full accent-emerald-500 h-2"
                        />
                        <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                          <span>0° 夹紧</span><span>90°</span><span>180° 全开</span>
                        </div>
                      </div>

                      {/* 关节连动说明 */}
                      {parentPart && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700">
                          💡 父关节「{parentPart.name}」旋转 X° 时，夹爪也可设置为张开 {mult.toFixed(1)}×X°
                        </div>
                      )}

                      {/* 张开倍数 */}
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">
                          张开倍数（用于联动计算参考）：{mult.toFixed(1)}×
                        </label>
                        <input
                          type="range"
                          min={0.5}
                          max={5}
                          step={0.1}
                          value={mult}
                          onChange={(e) =>
                            updatePart(selected.id, { gripperMultiplier: parseFloat(e.target.value) })
                          }
                          className="w-full accent-emerald-500 h-1.5"
                        />
                        <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                          <span>0.5×</span><span>{mult.toFixed(1)}×</span><span>5×</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 相对位置 */}
                {selected.parentId && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <h3 className="text-[12px] font-semibold mb-3 flex items-center gap-2">
                      <Link2 className="h-3.5 w-3.5" />相对位置
                    </h3>
                    <div className="mb-3">
                      <label className="text-[10px] text-slate-500 block mb-1">链接距离</label>
                      <input
                        type="number"
                        step={0.05}
                        value={positionLength(selected.position).toFixed(2)}
                        onChange={(e) => {
                          const dist = parseFloat(e.target.value) || 0;
                          updatePart(selected.id, { position: scalePosition(selected.position, dist) });
                        }}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-mono"
                      />
                      <input
                        type="range"
                        min={0.05}
                        max={1.5}
                        step={0.01}
                        value={positionLength(selected.position)}
                        onChange={(e) => {
                          const dist = parseFloat(e.target.value);
                          updatePart(selected.id, { position: scalePosition(selected.position, dist) });
                        }}
                        className="w-full mt-2 accent-violet-500 h-1.5"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {["X", "Y", "Z"].map((ax, i) => (
                        <div key={ax}>
                          <label className="text-[10px] text-slate-500 block mb-1">{ax}</label>
                          <input
                            type="number"
                            step={0.05}
                            value={selected.position[i].toFixed(2)}
                            onChange={(e) => {
                              const p = [...selected.position] as [number, number, number];
                              p[i] = parseFloat(e.target.value) || 0;
                              updatePart(selected.id, { position: p });
                            }}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ══ 旋转轴设置（仅关节） ══ */}
                {selected.type === "joint" && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <h3 className="text-[12px] font-semibold mb-3">旋转轴方向</h3>

                    {/* 旋转轴向量输入 */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {["X", "Y", "Z"].map((ax, i) => (
                        <div key={ax}>
                          <label className="text-[10px] text-slate-500 block mb-1">{ax}</label>
                          <input
                            type="number"
                            step={0.1}
                            value={selected.rotationAxis[i].toFixed(2)}
                            onChange={(e) => {
                              const a = [...selected.rotationAxis] as [number, number, number];
                              a[i] = parseFloat(e.target.value) || 0;
                              updatePart(selected.id, { rotationAxis: normalizeVector(a) });
                            }}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-mono"
                          />
                        </div>
                      ))}
                    </div>

                    {/* 预设轴快捷按钮 */}
                    <div className="flex gap-1.5 mb-3">
                      {([["X轴", [1,0,0]], ["Y轴", [0,1,0]], ["Z轴", [0,0,1]]] as const).map(([label, axis]) => (
                        <button
                          key={label}
                          onClick={() => updatePart(selected.id, { rotationAxis: axis as [number,number,number] })}
                          className={`flex-1 rounded-lg border py-1.5 text-[11px] font-mono transition-colors
                            ${JSON.stringify(selected.rotationAxis) === JSON.stringify(axis)
                              ? "border-violet-400 bg-violet-100 text-violet-700"
                              : "border-slate-200 hover:bg-slate-50"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* 轴长度 */}
                    <div className="mb-3">
                      <label className="text-[10px] text-slate-500 block mb-1">箭头长度：{selected.axisLength.toFixed(2)}</label>
                      <input
                        type="range"
                        min={0.1}
                        max={1.5}
                        step={0.05}
                        value={selected.axisLength}
                        onChange={(e) => updatePart(selected.id, { axisLength: parseFloat(e.target.value) })}
                        className="w-full accent-violet-500 h-1.5"
                      />
                    </div>

                    {/* 颜色 & 显示/隐藏 */}
                    <div className="flex gap-2">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-slate-500">颜色</label>
                        <input
                          type="color"
                          value={selected.axisColor}
                          onChange={(e) => updatePart(selected.id, { axisColor: e.target.value })}
                          className="h-7 w-12 rounded border border-slate-200 cursor-pointer"
                        />
                      </div>
                      <button
                        onClick={() => updatePart(selected.id, { axisVisible: !selected.axisVisible })}
                        className={`flex-1 rounded-lg border text-[11px] py-1 transition-colors ${selected.axisVisible
                          ? "border-violet-200 bg-violet-50 text-violet-700"
                          : "border-slate-200 bg-white text-slate-500"}`}
                      >
                        {selected.axisVisible ? "✓ 显示箭头" : "隐藏箭头"}
                      </button>
                    </div>
                  </div>
                )}

                {/* 底盘旋转轴显示（仅供参考，Y轴固定） */}
                {selected.type === "base" && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <h3 className="text-[12px] font-semibold mb-2">旋转轴（Y轴固定）</h3>
                    <div className="flex gap-2">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-slate-500">颜色</label>
                        <input
                          type="color"
                          value={selected.axisColor}
                          onChange={(e) => updatePart(selected.id, { axisColor: e.target.value })}
                          className="h-7 w-12 rounded border border-slate-200 cursor-pointer"
                        />
                      </div>
                      <button
                        onClick={() => updatePart(selected.id, { axisVisible: !selected.axisVisible })}
                        className={`flex-1 rounded-lg border text-[11px] py-1 transition-colors ${selected.axisVisible
                          ? "border-purple-200 bg-purple-50 text-purple-700"
                          : "border-slate-200 bg-white text-slate-500"}`}
                      >
                        {selected.axisVisible ? "✓ 显示Y轴箭头" : "隐藏Y轴箭头"}
                      </button>
                    </div>
                  </div>
                )}

              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <Settings className="h-10 w-10 text-slate-300 mb-3" />
                <p className="text-[13px] text-slate-600">选择部件进行编辑</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── 部件树渲染函数 ──────────────────────────────────────────────────────────────
function renderTree(
  part: Part,
  all: Part[],
  depth: number,
  selectedId: string | null,
  onSelect: (id: string) => void,
  onDelete: (id: string) => void,
  expanded: Set<string>,
  setExpanded: (s: Set<string>) => void
) {
  const hasChildren = part.childrenIds.length > 0;
  const isExp = expanded.has(part.id);
  const typeLabel = part.type === "base" ? "底盘" : part.type === "joint" ? "关节" : "夹爪";
  return (
    <div key={part.id}>
      <div
        className={`flex items-center rounded-lg px-2 py-2 cursor-pointer text-sm ${selectedId === part.id ? "bg-violet-50 text-violet-900" : "hover:bg-slate-50"}`}
        style={{ marginLeft: depth * 14 }}
        onClick={() => onSelect(part.id)}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const n = new Set(expanded);
              isExp ? n.delete(part.id) : n.add(part.id);
              setExpanded(n);
            }}
            className="mr-1 p-0.5 rounded hover:bg-slate-200"
          >
            {isExp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
        <div
          className="mr-2 h-5 w-5 rounded flex items-center justify-center"
          style={{ backgroundColor: `${PART_COLORS[part.type]}20` }}
        >
          {part.type === "base" ? <Box className="h-3 w-3" style={{ color: PART_COLORS.base }} />
            : part.type === "joint" ? <CircleDot className="h-3 w-3" style={{ color: PART_COLORS.joint }} />
            : <Grip className="h-3 w-3" style={{ color: PART_COLORS.gripper }} />}
        </div>
        <span className="flex-1 text-[13px] font-medium truncate">{part.name}</span>
        <span className="text-[9px] text-slate-400 mr-1">{typeLabel}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(part.id); }}
          className="ml-1 p-1 rounded opacity-0 hover:opacity-100 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {hasChildren && isExp && (
        <div>
          {part.childrenIds.map((cid) => {
            const child = all.find((p) => p.id === cid);
            return child
              ? renderTree(child, all, depth + 1, selectedId, onSelect, onDelete, expanded, setExpanded)
              : null;
          })}
        </div>
      )}
    </div>
  );
}
