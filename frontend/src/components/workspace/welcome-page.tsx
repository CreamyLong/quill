/**
 * Welcome Page — default landing page for the workspace.
 *
 * Displays when no chat or work task is selected. Provides quick access
 * to key features and shows recent activity.
 *
 * @module components/workspace/welcome-page
 */

"use client";

import Link from "next/link";
import {
  ArrowRight,
  Beaker,
  Brain,
  Code2,
  FlaskConical,
  MessageSquare,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function WelcomePage() {
  const { t } = useI18n();

  const quickActions = [
    {
      href: "/workspace/chats/new",
      icon: MessageSquare,
      title: "New Chat",
      description: "Start a conversation with the agent",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      href: "/workspace/experiments",
      icon: FlaskConical,
      title: "Experiments",
      description: "A/B test algorithm variants",
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      href: "/workspace/work",
      icon: Code2,
      title: "Work",
      description: "Manage coding tasks",
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
    },
  ];

  const features = [
    {
      icon: Brain,
      title: "Multi-Agent Orchestration",
      description: "Coordinate sub-agents for complex tasks",
    },
    {
      icon: Beaker,
      title: "Algorithm Research",
      description: "Compare and benchmark agent algorithms",
    },
    {
      icon: TrendingUp,
      title: "Statistical Analysis",
      description: "Significance testing and effect sizes",
    },
    {
      icon: Sparkles,
      title: "Self-Improving Skills",
      description: "Agent learns from experience",
    },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-auto bg-gradient-to-br from-background via-background to-muted/30 p-8">
      {/* Hero Section */}
      <div className="mb-12 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
          <Sparkles className="size-4" />
          <span>AI Agent Research Platform</span>
        </div>
        <h1 className="font-display text-4xl font-bold tracking-tight text-foreground md:text-5xl">
          Welcome to <span className="golden-text">Quill</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          A unified platform for AI agent research, algorithm comparison, and benchmark evaluation.
          Build, test, and publish your findings with confidence.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="mb-12 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className={cn("mb-4 inline-flex rounded-lg p-2.5", action.bgColor)}>
              <action.icon className={cn("size-5", action.color)} />
            </div>
            <h3 className="mb-1 font-semibold text-foreground">{action.title}</h3>
            <p className="text-sm text-muted-foreground">{action.description}</p>
            <ArrowRight className="absolute right-4 top-4 size-4 text-muted-foreground/50 transition-all duration-300 group-hover:translate-x-1 group-hover:text-primary" />
          </Link>
        ))}
      </div>

      {/* Features Grid */}
      <div className="w-full max-w-4xl">
        <h2 className="mb-6 text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Platform Capabilities
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-lg border border-border/50 bg-card/50 p-4 transition-all duration-300 hover:border-border hover:bg-card"
            >
              <feature.icon className="mb-3 size-5 text-muted-foreground transition-colors group-hover:text-primary" />
              <h3 className="mb-1 text-sm font-medium text-foreground">{feature.title}</h3>
              <p className="text-xs text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 text-center text-sm text-muted-foreground">
        <p>
          Press{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
            ⌘K
          </kbd>{" "}
          to open the command palette
        </p>
      </div>
    </div>
  );
}
