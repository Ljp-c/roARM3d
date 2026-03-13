/**
 * useSerialData Hook
 * 管理串口连接、数据接收和关节绑定更新
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { serialManager } from "./serialPort";
import { SerialStatus, SerialData, SerialBindings, SerialLogEntry, SerialConfig } from "../types/serial";

interface UseSerialDataOptions {
  enabled?: boolean;
  bindings?: SerialBindings;
  onDataParsed?: (data: SerialData) => void;
  onStatusChanged?: (status: SerialStatus) => void;
}

interface UseSerialDataResult {
  status: SerialStatus;
  isSupported: boolean;
  logs: SerialLogEntry[];
  lastError: string | null;
  connect: (baudRate: number) => Promise<void>;
  disconnect: () => Promise<void>;
  clearLogs: () => void;
}

/**
 * React Hook for managing serial port connection and data handling
 */
export function useSerialData(options: UseSerialDataOptions = {}): UseSerialDataResult {
  const { enabled = true, onDataParsed, onStatusChanged } = options;

  const [status, setStatus] = useState<SerialStatus>(serialManager.getStatus());
  const [logs, setLogs] = useState<SerialLogEntry[]>(serialManager.getLogs());
  const [lastError, setLastError] = useState<string | null>(serialManager.getLastError());

  const unsubscribeRef = useRef<Array<() => void>>([]);

  // 处理接收到的串口数据
  const handleSerialData = useCallback(
    (data: SerialData) => {
      // 触发回调
      if (onDataParsed) {
        onDataParsed(data);
      }
    },
    [onDataParsed]
  );

  // 处理状态改变
  const handleStatusChanged = useCallback(
    (newStatus: SerialStatus) => {
      setStatus(newStatus);
      setLastError(serialManager.getLastError());

      if (onStatusChanged) {
        onStatusChanged(newStatus);
      }
    },
    [onStatusChanged]
  );

  // 更新日志视图
  const updateLogs = useCallback(() => {
    setLogs([...serialManager.getLogs()]);
  }, []);

  // 初始化事件监听
  useEffect(() => {
    if (!enabled) return;

    // 注册数据接收回调
    const unsubscribeData = serialManager.onDataReceived(handleSerialData);
    unsubscribeRef.current.push(unsubscribeData);

    // 注册状态改变回调
    const unsubscribeStatus = serialManager.onStatusChanged(handleStatusChanged);
    unsubscribeRef.current.push(unsubscribeStatus);

    // 定期更新日志视图（每 500ms）
    const logInterval = setInterval(updateLogs, 500);

    return () => {
      unsubscribeRef.current.forEach((unsub: () => void) => unsub());
      unsubscribeRef.current = [];
      clearInterval(logInterval);
    };
  }, [enabled, handleSerialData, handleStatusChanged, updateLogs]);

  // 连接串口
  const connect = useCallback(
    async (baudRate: number) => {
      try {
        const config: SerialConfig = { baudRate };
        await serialManager.connect(config);
        setStatus(serialManager.getStatus());
      } catch (error) {
        setLastError(serialManager.getLastError());
        throw error;
      }
    },
    []
  );

  // 断开串口
  const disconnect = useCallback(async () => {
    try {
      await serialManager.disconnect();
      setStatus(serialManager.getStatus());
      setLastError(null);
    } catch (error) {
      setLastError(serialManager.getLastError());
      throw error;
    }
  }, []);

  // 清空日志
  const clearLogs = useCallback(() => {
    serialManager.clearLogs();
    setLogs([]);
  }, []);

  return {
    status,
    isSupported: serialManager.isSupported(),
    logs,
    lastError,
    connect,
    disconnect,
    clearLogs,
  };
}

/**
 * 根据绑定关系将串口数据映射到关节ID
 * @param serialData - 串口接收的数据 { J1: 45, J2: 90 }
 * @param bindings - 关节ID到字段名的映射 { partId1: "J1", partId2: "J2" }
 * @returns 关节ID到角度的映射 { partId1: 45, partId2: 90 }
 */
export function mapSerialDataToJoints(
  serialData: SerialData,
  bindings: SerialBindings
): Record<string, number> {
  const result: Record<string, number> = {};

  // 反向映射：从字段名到关节ID
  const fieldToPartId: Record<string, string> = {};
  for (const [partId, fieldName] of Object.entries(bindings)) {
    fieldToPartId[fieldName] = partId;
  }

  // 将串口数据映射到关节
  for (const [fieldName, value] of Object.entries(serialData)) {
    const partId = fieldToPartId[fieldName];
    if (partId) {
      result[partId] = value;
    }
  }

  return result;
}
