import React, { useEffect, useState } from 'react';
import { Check, Copy, FileCode2, FolderTree } from 'lucide-react';
import { BUG_FIX_RECORDS } from '../data/bugFixes';
import type { WorkspaceFileEntry } from '../types/bluetooth';

export const CodeAndBugFixes: React.FC = () => {
  const [layerFilter, setLayerFilter] = useState<'all' | 'backend' | 'frontend'>('all');
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('README.md');
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/workspace/files')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: WorkspaceFileEntry[]) => {
        setFiles(list);
        if (list.length > 0 && !list.some((f) => f.path === selectedPath)) {
          setSelectedPath(list[0].path);
        }
      })
      .catch(() => setFiles([]));
  }, []);

  useEffect(() => {
    if (!selectedPath) return;
    setLoadingFile(true);
    fetch(`/api/workspace/file?path=${encodeURIComponent(selectedPath)}`)
      .then((res) => (res.ok ? res.json() : { content: 'Unable to load file.' }))
      .then((data: { content: string }) => {
        setFileContent(data.content || '');
      })
      .catch(() => setFileContent('Unable to load file.'))
      .finally(() => setLoadingFile(false));
  }, [selectedPath]);

  const filteredBugs = BUG_FIX_RECORDS.filter(
    (b) => layerFilter === 'all' || b.layer === layerFilter
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fileContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">
              Codebase Audit &amp; Bug-Fix Changelog
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              All {BUG_FIX_RECORDS.length} defects identified and resolved across the separate Rust backend and Angular frontend folders.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-zinc-950 p-1 border border-zinc-800">
            <button
              type="button"
              onClick={() => setLayerFilter('all')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                layerFilter === 'all'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({BUG_FIX_RECORDS.length})
            </button>
            <button
              type="button"
              onClick={() => setLayerFilter('backend')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                layerFilter === 'backend'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Rust Backend ({BUG_FIX_RECORDS.filter((b) => b.layer === 'backend').length})
            </button>
            <button
              type="button"
              onClick={() => setLayerFilter('frontend')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                layerFilter === 'frontend'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Angular Frontend ({BUG_FIX_RECORDS.filter((b) => b.layer === 'frontend').length})
            </button>
          </div>
        </div>

        <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
          {filteredBugs.map((bug) => (
            <article key={bug.id} className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 text-xs text-zinc-400">
                  <span className="font-mono font-semibold text-sky-400">{bug.id}</span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">
                    {bug.layer === 'backend' ? 'Rust Backend' : 'Angular Frontend'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      bug.severity === 'Critical'
                        ? 'font-medium text-red-400'
                        : bug.severity === 'High'
                        ? 'font-medium text-amber-400'
                        : 'font-medium text-zinc-300'
                    }
                  >
                    {bug.severity}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-zinc-500">{bug.file}</span>
              </div>
              <h2 className="text-sm font-semibold text-zinc-100">{bug.title}</h2>
              <div className="mt-2 grid grid-cols-1 gap-3 text-xs leading-relaxed md:grid-cols-2">
                <div className="rounded border border-zinc-800/80 bg-zinc-900/50 p-3">
                  <div className="mb-1 font-medium text-zinc-400">Root Cause</div>
                  <p className="text-zinc-300">{bug.symptom}</p>
                </div>
                <div className="rounded border border-zinc-800/80 bg-zinc-900/50 p-3">
                  <div className="mb-1 font-medium text-emerald-400">Applied Fix</div>
                  <p className="text-zinc-300">{bug.fix}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              Separated Project Folders (`bluetooth-packet-tracker/`)
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Browse and copy the audited Monolithic Rust backend, Modular Angular frontend, README, and BUG_FIXES files on disk.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy File
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <nav
            aria-label="Workspace files"
            className="max-h-[520px] overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 lg:col-span-1"
          >
            <div className="mb-2 flex items-center gap-2 px-2 py-1 text-xs font-medium text-zinc-400">
              <FolderTree className="h-3.5 w-3.5" aria-hidden="true" />
              bluetooth-packet-tracker/
            </div>
            <ul className="space-y-0.5">
              {files.map((file) => {
                const active = file.path === selectedPath;
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                        active
                          ? 'bg-blue-600/20 text-sky-300'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                      }`}
                    >
                      <FileCode2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{file.path}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 lg:col-span-3">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400">
              <span className="font-mono text-zinc-200">
                bluetooth-packet-tracker/{selectedPath}
              </span>
              <span className="font-mono tabular-nums">
                {fileContent.split('\n').length} lines
              </span>
            </div>
            <pre className="max-h-[480px] overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-200">
              {loadingFile ? 'Loading file...' : fileContent}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
};
