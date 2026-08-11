'use client';

import Link from 'next/link';
import { Bot, Globe, Zap, Shield, ArrowRight } from 'lucide-react';

const features = [
  {
    icon: Bot,
    title: 'Autonomous Agents',
    description:
      'Deploy AI agents that navigate, interact, and complete tasks on any website without manual intervention.',
  },
  {
    icon: Globe,
    title: 'Universal Browser Access',
    description:
      'Full Playwright-backed browser control with screenshots, form filling, navigation, and content extraction.',
  },
  {
    icon: Zap,
    title: 'Lightning-Fast Execution',
    description:
      'Powered by Groq LPU inference for near-instant LLM decisions. Watch agents complete complex workflows in seconds.',
  },
  {
    icon: Shield,
    title: 'Enterprise-Grade Safety',
    description:
      'Built-in watchdogs, boundary enforcement, and secure credential handling keep every run controlled and auditable.',
  },
];

function BrowserIllustration() {
  return (
    <svg
      viewBox="0 0 600 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-2xl mx-auto"
      aria-hidden="true"
    >
      <rect
        x="40"
        y="40"
        width="520"
        height="280"
        rx="12"
        fill="#1e293b"
        stroke="#334155"
        strokeWidth="2"
      />
      <rect x="40" y="40" width="520" height="36" rx="12" fill="#0f172a" />
      <circle cx="70" cy="58" r="6" fill="#ef4444" opacity="0.9" />
      <circle cx="90" cy="58" r="6" fill="#f59e0b" opacity="0.9" />
      <circle cx="110" cy="58" r="6" fill="#22c55e" opacity="0.9" />
      <rect x="220" y="50" width="160" height="16" rx="4" fill="#1e293b" />
      <rect
        x="260"
        y="100"
        width="80"
        height="10"
        rx="2"
        fill="#334155"
        opacity="0.6"
      />
      <rect
        x="260"
        y="118"
        width="120"
        height="10"
        rx="2"
        fill="#334155"
        opacity="0.4"
      />
      <rect
        x="260"
        y="136"
        width="100"
        height="10"
        rx="2"
        fill="#334155"
        opacity="0.3"
      />
      <rect
        x="260"
        y="160"
        width="60"
        height="24"
        rx="4"
        fill="#6366f1"
        opacity="0.8"
      />
      <rect x="340" y="160" width="60" height="24" rx="4" fill="#334155" />
      <rect
        x="130"
        y="130"
        width="100"
        height="130"
        rx="8"
        fill="#0f172a"
        stroke="#334155"
        strokeWidth="1"
      />
      <rect
        x="145"
        y="150"
        width="70"
        height="8"
        rx="2"
        fill="#22c55e"
        opacity="0.5"
      />
      <rect
        x="145"
        y="168"
        width="55"
        height="8"
        rx="2"
        fill="#22c55e"
        opacity="0.4"
      />
      <rect
        x="145"
        y="186"
        width="60"
        height="8"
        rx="2"
        fill="#22c55e"
        opacity="0.3"
      />
      <rect
        x="145"
        y="210"
        width="40"
        height="10"
        rx="2"
        fill="#6366f1"
        opacity="0.6"
      />
      <circle
        cx="470"
        cy="210"
        r="32"
        fill="#6366f1"
        opacity="0.15"
        stroke="#6366f1"
        strokeWidth="1.5"
      />
      <path
        d="M460 210 L470 220 L485 200"
        stroke="#6366f1"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold text-slate-900 dark:text-white">
          Browser Use
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <main>
        <section className="mx-auto max-w-7xl px-6 pt-20 pb-24 text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Now powered by Groq LPU inference
          </p>
          <h1 className="mx-auto max-w-4xl text-5xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-6xl">
            Autonomous browser agents
            <br />
            <span className="text-slate-500 dark:text-slate-400">
              that actually work.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
            Deploy AI-powered agents to navigate the web, fill forms, extract
            data, and complete multi-step tasks at scale — all from a single
            dashboard.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              Start Automating
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              Sign in to Dashboard
            </Link>
          </div>

          <div className="mt-20">
            <BrowserIllustration />
          </div>
        </section>

        <section className="border-t border-slate-100 bg-slate-50/50 py-24 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-16 text-center">
              <h2 className="text-3xl font-semibold text-slate-900 dark:text-white">
                Built for production automation
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300">
                Everything you need to build, monitor, and scale browser
                automation workflows.
              </p>
            </div>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={feature.title}
                    className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      {feature.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {feature.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100 py-10 dark:border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {' '}
            Browser Use Dashboard. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link
              href="/privacy"
              className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Terms
            </Link>
            <Link
              href="/acceptable-use"
              className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Acceptable use
            </Link>
            <Link
              href="/cookies"
              className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Cookies
            </Link>
            <Link
              href="/login"
              className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Get Started
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
