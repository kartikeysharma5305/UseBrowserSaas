'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  runId: string | null;
  scheduleId: string | null;
  createdAt: string;
  readAt: string | null;
  deliveries: Array<{ status: string; sentAt: string | null }>;
};

export function NotificationsDashboard() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const response = await fetch('/api/notifications?limit=50');
      if (!response.ok) throw new Error();
      setItems((await response.json()).data);
      setError(null);
    } catch {
      setError('Unable to load notifications. Please try again.');
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const read = async (id: string) => {
    const response = await fetch(
      `/api/notifications/${encodeURIComponent(id)}/read`,
      { method: 'POST' }
    );
    if (response.ok)
      setItems(
        (current) =>
          current?.map((item) =>
            item.id === id
              ? { ...item, readAt: new Date().toISOString() }
              : item
          ) ?? null
      );
  };
  const readAll = async () => {
    const response = await fetch('/api/notifications/read-all', {
      method: 'POST',
    });
    if (response.ok)
      setItems(
        (current) =>
          current?.map((item) => ({
            ...item,
            readAt: item.readAt ?? new Date().toISOString(),
          })) ?? null
      );
  };

  if (!items && !error)
    return (
      <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
    );
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          onClick={() => void readAll()}
          disabled={!items?.some((item) => !item.readAt)}
        >
          Mark all read
        </Button>
      </div>
      {error ? (
        <Card className="p-5 text-sm text-red-700 dark:text-red-300">
          {error}
        </Card>
      ) : null}
      {items?.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          No notifications yet.
        </Card>
      ) : null}
      {items?.map((item) => {
        const href = item.runId
          ? `/dashboard/runs/${item.runId}`
          : item.scheduleId
            ? '/dashboard/schedules'
            : null;
        return (
          <Card
            key={item.id}
            className={`p-5 ${item.readAt ? '' : 'border-slate-400 dark:border-slate-500'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-slate-900 dark:text-white">
                  {item.title}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(item.createdAt).toLocaleString()} · Email{' '}
                  {item.deliveries[0]?.status.toLowerCase() ?? 'not requested'}
                </p>
              </div>
              <div className="flex gap-3">
                {href ? (
                  <Link className="text-sm font-medium underline" href={href}>
                    View details
                  </Link>
                ) : null}
                {!item.readAt ? (
                  <button
                    className="text-sm font-medium underline"
                    onClick={() => void read(item.id)}
                  >
                    Mark read
                  </button>
                ) : null}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
