"use client";

import {
  Copy,
  Flag,
  MoreHorizontal,
  MoreVertical,
  Reply,
  Trash2,
  UserMinus2,
  Bot,
  User,
  Mail,
  Bug,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type StatusType = "online" | "dnd" | "offline";

interface Message {
  id: number | string;
  text: string;
  sender: {
    id: string;
    name: string;
    avatar?: string;
  };
  time: string;
}

interface MessagingConversationProps {
  messages: Message[];
  otherUser?: {
    id: string;
    name: string;
    avatar?: string;
    status?: StatusType;
  };
  className?: string;
  onMessageAction?: (action: string, messageId: number | string) => void;
  onDeleteChat?: () => void;
  onSendEmail?: () => void;
  onReportBug?: () => void;
  rawMessages?: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: Date }>;
}

const STATUS_COLORS: Record<StatusType, string> = {
  online: "bg-green-500",
  dnd: "bg-red-500",
  offline: "bg-gray-400",
};

function StatusBadge({ status }: { status: StatusType }) {
  return (
    <span
      aria-label={status}
      className={cn(
        "inline-block size-3 rounded-full border-2 border-background",
        STATUS_COLORS[status]
      )}
      title={status.charAt(0).toUpperCase() + status.slice(1)}
    />
  );
}

// Redesigned user actions block (for conversation - header)
function UserActionsMenu({
  onDeleteChat,
  onSendEmail,
  onReportBug,
}: {
  onDeleteChat?: () => void;
  onSendEmail?: () => void;
  onReportBug?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="User actions"
          className="border-muted-foreground/30"
          size="icon"
          type="button"
          variant="outline"
        >
          <MoreVertical
            aria-hidden="true"
            className="size-4"
            focusable="false"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-36 rounded-lg bg-popover p-1 shadow-xl">
        <div className="flex flex-col gap-1">
          <Button
            className="w-full justify-start gap-2 rounded bg-transparent text-destructive hover:bg-accent"
            size="sm"
            type="button"
            variant="ghost"
            onClick={onDeleteChat}
          >
            <Trash2 aria-hidden="true" className="size-4" focusable="false" />
            <span className="font-medium text-xs">Cancella chat</span>
          </Button>
          <Button
            className="w-full justify-start gap-2 rounded bg-transparent text-blue-600 hover:bg-accent"
            size="sm"
            type="button"
            variant="ghost"
            onClick={onSendEmail}
          >
            <Mail aria-hidden="true" className="size-4" focusable="false" />
            <span className="font-medium text-xs">Invia email</span>
          </Button>
          <Button
            className="w-full justify-start gap-2 rounded bg-transparent text-yellow-600 hover:bg-accent"
            size="sm"
            type="button"
            variant="ghost"
            onClick={onReportBug}
          >
            <Bug aria-hidden="true" className="size-4" focusable="false" />
            <span className="font-medium text-xs">Segnala un bug</span>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Redesigned message actions block (for single message, on hover)
function MessageActions({ isMe, onAction, messageId }: { isMe: boolean; onAction?: (action: string, messageId: number | string) => void; messageId: number | string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Message actions"
          className="size-7 rounded bg-background hover:bg-accent"
          size="icon"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal
            aria-hidden="true"
            className="size-3.5"
            focusable="false"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-40 rounded-lg bg-popover p-1 shadow-xl"
      >
        <div className="flex flex-col gap-1">
          <Button
            aria-label="Reply"
            className="w-full justify-start gap-2 rounded px-2 py-1 text-xs"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => onAction?.("reply", messageId)}
          >
            <Reply aria-hidden="true" className="size-3" focusable="false" />
            <span>Reply</span>
          </Button>
          <Button
            aria-label="Copy"
            className="w-full justify-start gap-2 rounded px-2 py-1 text-xs"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => {
              // Copy to clipboard
              const message = document.querySelector(`[data-message-id="${messageId}"]`)?.textContent;
              if (message) {
                navigator.clipboard.writeText(message);
              }
              onAction?.("copy", messageId);
            }}
          >
            <Copy aria-hidden="true" className="size-3" focusable="false" />
            <span>Copy</span>
          </Button>
          {isMe ? (
            <Button
              aria-label="Delete"
              className="w-full justify-start gap-2 rounded px-2 py-1 text-destructive text-xs"
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => onAction?.("delete", messageId)}
            >
              <Trash2 aria-hidden="true" className="size-3" focusable="false" />
              <span>Delete</span>
            </Button>
          ) : null}
          <Button
            aria-label="Report"
            className="w-full justify-start gap-2 rounded px-2 py-1 text-xs text-yellow-600"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => onAction?.("report", messageId)}
          >
            <Flag aria-hidden="true" className="size-3" focusable="false" />
            <span>Report</span>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function MessagingConversation({
  messages,
  otherUser,
  className,
  onMessageAction,
  onDeleteChat,
  onSendEmail,
  onReportBug,
  rawMessages,
}: MessagingConversationProps) {
  const DEMO_USER = {
    id: "user-123",
    name: "You",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=you",
  };

  const DEMO_OTHER = otherUser || {
    id: "assistant-456",
    name: "AI Assistant",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=ai",
    status: "online" as StatusType,
  };

  return (
    <Card
      className={cn(
        "mx-auto flex h-full min-h-0 w-full grow flex-col overflow-hidden shadow-none",
        className
      )}
    >
      {/* Header */}
      <CardHeader className="sticky top-0 z-10 flex flex-row items-center justify-between gap-2 border-b bg-background px-4 py-2">
        <div className="flex items-center gap-3 pt-1">
          <div className="relative">
            <Avatar>
              <AvatarImage alt={DEMO_OTHER.name} src={DEMO_OTHER.avatar} />
              <AvatarFallback>
                {DEMO_OTHER.name === "AI Assistant" ? (
                  <Bot className="h-5 w-5" />
                ) : (
                  DEMO_OTHER.name[0]
                )}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="flex flex-col">
            <div className="font-semibold text-base">{DEMO_OTHER.name}</div>
            {DEMO_OTHER.status && (
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <StatusBadge status={DEMO_OTHER.status} /> {DEMO_OTHER.status}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UserActionsMenu
            onDeleteChat={onDeleteChat}
            onSendEmail={onSendEmail}
            onReportBug={onReportBug}
          />
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea
          aria-label="Conversation transcript"
          className="flex h-full max-h-full flex-col gap-6 bg-background p-4"
          role="log"
        >
          {messages.map((msg) => {
            const isMe = msg.sender.id === DEMO_USER.id;
            return (
              <div
                className={cn(
                  "group my-4 flex gap-2",
                  isMe ? "justify-end" : "justify-start"
                )}
                key={msg.id}
              >
                <div
                  className={cn(
                    "flex max-w-[80%] items-start gap-2",
                    isMe ? "flex-row-reverse" : undefined
                  )}
                >
                  <Avatar className="size-8">
                    <AvatarImage
                      alt={msg.sender.name}
                      src={msg.sender.avatar}
                    />
                    <AvatarFallback>
                      {msg.sender.name === "AI Assistant" ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        msg.sender.name[0]
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div
                      data-message-id={msg.id}
                      className={cn(
                        "rounded-md px-3 py-2 text-sm",
                        isMe
                          ? "bg-primary text-primary-foreground"
                          : "bg-accent text-foreground"
                      )}
                    >
                      {msg.text}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <time
                        aria-label={`Sent at ${msg.time}`}
                        className="text-muted-foreground text-xs"
                        dateTime={msg.time}
                      >
                        {msg.time}
                      </time>
                      <div className="opacity-0 transition-all group-hover:opacity-100">
                        <MessageActions isMe={isMe} onAction={onMessageAction} messageId={msg.id} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

