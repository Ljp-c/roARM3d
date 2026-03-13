import { useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useSerialData } from "../utils/useSerialData";
import { SerialLogEntry } from "../types/serial";

interface SerialControlPanelProps {
  onConnected?: () => void;
}

export function SerialControlPanel({ onConnected }: SerialControlPanelProps) {
  const [baudRate, setBaudRate] = useState(115200);
  const [showLogs, setShowLogs] = useState(false);

  const { status, isSupported, logs, lastError, connect, disconnect, clearLogs } = useSerialData({
    enabled: true,
  });

  const handleConnect = async () => {
    try {
      await connect(baudRate);
      onConnected?.();
    } catch (error) {
      console.error("连接失败:", error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error("断开失败:", error);
    }
  };

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  const getStatusColor = () => {
    if (isConnected) return "text-green-600";
    if (isConnecting) return "text-amber-600";
    if (status === "error") return "text-red-600";
    return "text-slate-400";
  };

  const getStatusBgColor = () => {
    if (isConnected) return "bg-green-50 border-green-200";
    if (isConnecting) return "bg-amber-50 border-amber-200";
    if (status === "error") return "bg-red-50 border-red-200";
    return "bg-slate-50 border-slate-200";
  };

  const statusText = {
    disconnected: "未连接",
    connecting: "连接中...",
    connected: "已连接",
    error: "错误",
  }[status];

  return (
    <div className="border-b border-slate-200 p-3">
      <h3 className="text-[12px] font-semibold mb-3 flex items-center gap-2 text-slate-700">
        <Wifi className="h-4 w-4" />
        串口通讯
      </h3>

      {!isSupported ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-700 mb-3">
          <p className="font-medium">⚠️ 浏览器不支持 Web Serial API</p>
          <p className="mt-1 text-[10px] opacity-80">请使用 Chrome、Edge 或其他支持的浏览器</p>
        </div>
      ) : (
        <>
          {/* 连接状态指示 */}
          <div className={`rounded-lg border p-2.5 mb-3 flex items-center gap-2 transition-colors ${getStatusBgColor()}`}>
            <div
              className={`h-2.5 w-2.5 rounded-full animate-pulse ${
                isConnected ? "bg-green-500" : isConnecting ? "bg-amber-500" : "bg-slate-400"
              }`}
            />
            <span className={`text-[11px] font-medium ${getStatusColor()}`}>{statusText}</span>
            {lastError && status === "error" && (
              <span className="text-[10px] text-red-600 ml-auto">{lastError}</span>
            )}
          </div>

          {/* 波特率选择 */}
          <div className="mb-3">
            <label className="text-[10px] text-slate-600 block mb-1.5">波特率</label>
            <select
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              disabled={isConnected}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value={9600}>9600</option>
              <option value={19200}>19200</option>
              <option value={38400}>38400</option>
              <option value={57600}>57600</option>
              <option value={115200}>115200</option>
              <option value={230400}>230400</option>
              <option value={460800}>460800</option>
            </select>
          </div>

          {/* 连接/断开按钮 */}
          <div className="flex gap-2 mb-3">
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="flex-1 rounded-lg bg-blue-500 text-white text-[11px] font-medium py-2 hover:bg-blue-600 disabled:bg-slate-300 flex items-center justify-center gap-1.5"
              >
                <Wifi className="h-3.5 w-3.5" />
                {isConnecting ? "连接中..." : "连接"}
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex-1 rounded-lg bg-red-500 text-white text-[11px] font-medium py-2 hover:bg-red-600 flex items-center justify-center gap-1.5"
              >
                <WifiOff className="h-3.5 w-3.5" />
                断开连接
              </button>
            )}
            <button
              onClick={() => setShowLogs(!showLogs)}
              className={`px-3 rounded-lg border text-[11px] font-medium transition-colors ${
                showLogs
                  ? "border-violet-300 bg-violet-50 text-violet-700"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              日志
            </button>
          </div>

          {/* 日志显示面板 */}
          {showLogs && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden mb-3 flex flex-col max-h-48">
              <div className="flex items-center justify-between px-2.5 py-2 border-b border-slate-200 bg-white">
                <span className="text-[10px] font-semibold text-slate-700">日志记录</span>
                <button
                  onClick={clearLogs}
                  className="text-[9px] text-slate-500 hover:text-slate-700 font-medium"
                >
                  清空
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[9px]">
                {logs.length === 0 ? (
                  <div className="text-slate-400 text-center py-2">暂无日志</div>
                ) : (
                  logs.map((log) => <LogEntry key={log.id} log={log} />)
                )}
              </div>
            </div>
          )}

          {/* 数据格式说明 */}
          <div className="rounded-lg border border-slate-200 bg-blue-50 p-2.5 text-[10px] text-slate-600">
            <p className="font-medium text-blue-700 mb-1">📋 支持的数据格式</p>
            <ul className="space-y-1">
              <li className="font-mono">J1:45 J2:90 J3:120</li>
              <li className="font-mono">J1=45&J2=90&J3=120</li>
              <li className="font-mono">{"{\"J1\":45, \"J2\":90}"}</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function LogEntry({ log }: { log: SerialLogEntry }) {
  const typeColors = {
    info: "text-slate-600",
    warning: "text-amber-600",
    error: "text-red-600",
    data: "text-green-600",
  };

  const typeIcons = {
    info: "ℹ",
    warning: "⚠",
    error: "✗",
    data: "✓",
  };

  return (
    <div className={typeColors[log.type]}>
      <span className="font-bold mr-1">[{typeIcons[log.type]}]</span>
      <span>{log.message}</span>
      {log.data && <span className="ml-1 text-slate-400">({JSON.stringify(log.data)})</span>}
    </div>
  );
}
