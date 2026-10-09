import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RefreshCw, XCircle } from 'lucide-react';
import { t, useT } from '../../i18n';

function newSessionId() {
  return `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function TerminalPage({ hostId, containerId }: { hostId: string; containerId?: string }) {
  const t = useT();
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

    // a fresh id per attempt: dev StrictMode double-mounts (and manual
    // reconnects) must not reuse the main-process session slot of a
    // possibly still-live shell
    const sessionId = newSessionId();

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
      // containerId present → exec inside the container; otherwise an SSH host shell
      if (containerId) {
        await window.dockerApi.openExec(hostId, containerId, sessionId);
      } else {
        await window.dockerApi.openHostExec(sessionId, hostId);
      }
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
  }, [hostId, containerId]);

  useEffect(() => {
    const fitIfVisible = () => {
      // while the tab is hidden (keep-alive display:none) the wrapper has no
      // size — fitting then would corrupt cols/rows with zeros
      if (wrapRef.current && wrapRef.current.clientWidth > 0) fitRef.current?.fit();
    };
    const onResize = () => fitIfVisible();
    window.addEventListener('resize', onResize);
    // re-fit when the tab becomes visible again (box 0 → N)
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && wrapRef.current) {
      ro = new ResizeObserver(() => fitIfVisible());
      ro.observe(wrapRef.current);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, []);

  const disconnect = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    // leave a visible trace in the scrollback and drop keyboard focus
    termRef.current?.writeln('\r\n\x1b[33m[已手动断开]\x1b[0m');
    termRef.current?.blur();
    setStatus('closed');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <div className="content-toolbar">
        <button
          className="btn"
          onClick={() => {
            void start();
          }}
        >
          <RefreshCw size={14} /> 重新连接
        </button>
        <button className="btn" onClick={disconnect} disabled={status === 'closed'}>
          <XCircle size={13} /> 断开
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {status === 'connecting' && t('连接中…')}
          {status === 'open' && (containerId ? t('已连接 · /bin/sh') : t('已连接 · 主机 shell'))}
          {status === 'closed' && t('已断开')}
          {status === 'error' && `错误: ${error || '未知'}`}
        </span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div className="terminal-wrap" ref={wrapRef} style={{ height: '100%' }} />
        {(status === 'closed' || status === 'error') && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: 'rgba(30, 30, 30, 0.72)',
            }}
          >
            <span style={{ color: '#d8d8d8', fontSize: 13 }}>
              {status === 'error' ? t('连接失败：{p0}', { p0: error || t('未知错误') }) : t('会话已断开')}
            </span>
            <button className="btn primary" onClick={() => void start()}>
              <RefreshCw size={13} /> 重新连接
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
