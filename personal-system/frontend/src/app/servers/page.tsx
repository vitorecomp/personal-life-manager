'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { ServerNode, ServerSummary, CheckType } from '@/lib/types';
import {
  Server,
  Plus,
  RefreshCw,
  Trash2,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
  Radio,
  Tag,
} from 'lucide-react';

export default function ServersPage() {
  const [servers, setServers] = useState<ServerNode[]>([]);
  const [summary, setSummary] = useState<ServerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // New server form
  const [name, setName] = useState('');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(22);
  const [checkType, setCheckType] = useState<CheckType>('tcp');
  const [httpUrl, setHttpUrl] = useState('');
  const [tags, setTags] = useState('homelab, vps');

  const loadServers = async () => {
    try {
      const [list, sum] = await Promise.all([
        api.getServers(),
        api.getServerSummary().catch(() => null),
      ]);
      setServers(list || []);
      setSummary(sum || null);
    } catch (err) {
      console.error('Failed to load servers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServers();
    const interval = setInterval(loadServers, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleCheckNow = async (id: string) => {
    setProbingId(id);
    try {
      const updated = await api.checkServer(id);
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)));
      const sum = await api.getServerSummary();
      setSummary(sum);
    } catch (err) {
      console.error('Failed to probe server:', err);
    } finally {
      setProbingId(null);
    }
  };

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !host.trim()) return;

    try {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const created = await api.createServer({
        name,
        host,
        port: Number(port) || 22,
        check_type: checkType,
        http_url: httpUrl,
        tags: tagList,
      });

      setServers((prev) => [...prev, created]);
      setShowAddModal(false);
      setName('');
      setHost('127.0.0.1');
      setPort(22);

      // Trigger immediate probe
      handleCheckNow(created.id);
    } catch (err) {
      console.error('Failed to add server:', err);
    }
  };

  const handleDeleteServer = async (id: string) => {
    if (!confirm('Are you sure you want to remove this server from monitoring?')) return;
    try {
      await api.deleteServer(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
      const sum = await api.getServerSummary();
      setSummary(sum);
    } catch (err) {
      console.error('Failed to delete server:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Server Infrastructure</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Administer server inventory, monitor live status, and run automated health checks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadServers()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Server
          </button>
        </div>
      </div>

      {/* Infrastructure Status Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-medium text-zinc-500">Total Nodes</p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
            {summary?.total_servers || servers.length}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Online & Healthy</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {summary?.online || 0}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Degraded</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
            {summary?.degraded || 0}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Offline / Unreachable</p>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
            {summary?.offline || 0}
          </p>
        </div>
      </div>

      {/* Server Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {servers.map((node) => {
          const isProbing = probingId === node.id;
          return (
            <div
              key={node.id}
              className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-indigo-500/40 transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                      <Server className="w-5 h-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold text-sm text-zinc-900 dark:text-white">{node.name}</h3>
                      <p className="text-xs font-mono text-zinc-400">
                        {node.host}:{node.port}
                      </p>
                    </div>
                  </div>

                  {/* Status Indicator */}
                  {node.status === 'online' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300/40 dark:border-emerald-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                      Online
                    </span>
                  )}
                  {node.status === 'degraded' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300/40 dark:border-amber-800">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Degraded
                    </span>
                  )}
                  {node.status === 'offline' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-300/40 dark:border-rose-800">
                      <XCircle className="w-3 h-3 mr-1" />
                      Offline
                    </span>
                  )}
                  {node.status === 'unknown' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      Pending
                    </span>
                  )}
                </div>

                {/* Details */}
                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
                    <span>Protocol:</span>
                    <span className="font-mono uppercase font-semibold text-zinc-700 dark:text-zinc-300">
                      {node.check_type}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
                    <span>Latency:</span>
                    <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">
                      {node.status === 'online' ? `${node.last_latency_ms} ms` : 'N/A'}
                    </span>
                  </div>

                  {node.last_message && (
                    <p className="text-[11px] text-zinc-400 truncate mt-1" title={node.last_message}>
                      {node.last_message}
                    </p>
                  )}

                  {node.tags && node.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {node.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <button
                  onClick={() => handleCheckNow(node.id)}
                  disabled={isProbing}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
                  {isProbing ? 'Probing...' : 'Check Now'}
                </button>

                <button
                  onClick={() => handleDeleteServer(node.id)}
                  className="text-zinc-400 hover:text-rose-500 transition p-1"
                  title="Remove server"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Add Monitored Server</h3>

            <form onSubmit={handleAddServer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Server Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Production VPS / Homelab Proxmox"
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Host / IP
                  </label>
                  <input
                    type="text"
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.1.100 or domain.com"
                    className="w-full px-3.5 py-2 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full px-3.5 py-2 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Health Check Protocol
                </label>
                <select
                  value={checkType}
                  onChange={(e) => setCheckType(e.target.value as CheckType)}
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="tcp">TCP Connection Probe</option>
                  <option value="http">HTTP Request Probe</option>
                </select>
              </div>

              {checkType === 'http' && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    HTTP Probe URL
                  </label>
                  <input
                    type="url"
                    value={httpUrl}
                    onChange={(e) => setHttpUrl(e.target.value)}
                    placeholder="https://example.com/health"
                    className="w-full px-3.5 py-2 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="homelab, vps, production"
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-sm"
                >
                  Add Node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
