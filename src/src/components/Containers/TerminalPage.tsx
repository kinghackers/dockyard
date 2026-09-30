import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RefreshCw, XCircle } from 'lucide-react';

function newSessionId() {
  return `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function TerminalPage({ hostId, containerId }: { hostId: string; containerId: string }) {
  const [sessionId] = useState(newSessionId);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const start = async () => {
    if (!wrapRef.current) return;
    setStatus('connecting');
    setError(null);

    // tear down any previous session first
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#bbbbbb',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
      },
      cursorBlink: true,
      convertEol: true,
      scrollback: 2000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(wrapRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      void window.dockerApi.execInput(sessionId, data);
    });

    term.onResize(({ rows, cols }) => {
      void window.dockerApi.execResize(sessionId, rows, cols);
    });

    const unsubData = window.dockerApi.onExecData((p) => {
      if (p.sessionId !== sessionId) return;
      term.write(p.data);
    });
    const unsubErr = window.dockerApi.onExecError((p) => {
      if (p.sessionId !== sessionId) return;
      setError(p.error);
      setStatus('error');
    });
    const unsubEnd = window.dockerApi.onExecEnd((p) => {
      if (p.sessionId !== sessionId) return;
      setStatus('closed');
      term.writeln('\r\n\x1b[33m[会话已结束]\x1b[0m');
    });

    const cleanup = () => {
      unsubData();
      unsubErr();
      unsubEnd();
      void window.dockerApi.closeExec(sessionId);
    };
    cleanupRef.current = cleanup;

    try {
      await window.dockerApi.openExec(hostId, containerId, sessionId);
      // if unmounted while opening, abort the session we just created
      if (cleanupRef.current !== cleanup) {
        cleanup();
        return;
      }
      setStatus('open');
      term.focus();
      void window.dockerApi.execResize(sessionId, term.rows, term.cols);
    } catch (e) {
      if (cleanupRef.current === cleanup) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      } else {
        cleanup();
      }
    }
  };

  useEffect(() => {
    void start();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hostId, containerId]);

  useEffect(() => {
    const onResize = () => {
      fitRef.current?.fit();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="content-toolbar">
        <button
          className="btn"
          onClick={() => {
            cleanupRef.current?.();
            cleanupRef.current = null;
            void start();
          }}
        >
          <RefreshCw size={14} /> 重新连接
        </button>
        <button
          className="btn"
          onClick={() => {
            cleanupRef.current?.();
            cleanupRef.current = null;
            setStatus('closed');
          }}
        >
          <XCircle size={13} /> 断开
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {status === 'connecting' && '连接中…'}
          {status === 'open' && '已连接 · /bin/sh'}
          {status === 'closed' && '已断开'}
          {status === 'error' && `错误: ${error || '未知'}`}
        </span>
      </div>
      <div className="terminal-wrap" ref={wrapRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
