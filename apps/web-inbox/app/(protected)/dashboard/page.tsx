import prisma from '@/lib/db';
export const dynamic = 'force-dynamic';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Link from 'next/link';
import { AiToggleButton } from '@/components/ai-toggle-button';
import { ChatInputWithSuggestion } from '@/components/chat-input-with-suggestion';

export default async function DashboardPage({
    searchParams,
}: {
    searchParams: { chatId?: string };
}) {
    const conversations = await prisma.conversation.findMany({
        include: {
            contact: true,
            workspace: {
                include: { tenantOrg: true }
            },
        },
        orderBy: {
            updatedAt: 'desc',
        },
    });

    const selectedChatId = searchParams.chatId;
    const currentConversation = conversations.find((c) => c.id === selectedChatId);

    const messages = selectedChatId
        ? await prisma.message.findMany({
            where: { conversationId: selectedChatId },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                conversationId: true,
                senderType: true,
                contentText: true,
                contentPayload: true,
                suggestedReply: true,
                createdAt: true,
            },
        })
        : [];

    return (
        <div className="flex h-full bg-background font-sans antialiased text-foreground">
            {/* Conversation List */}
            <div className="w-80 border-r bg-muted/30 flex flex-col">
                <div className="p-4 border-b bg-background/50 backdrop-blur-sm">
                    <h2 className="font-semibold text-lg">Conversations</h2>
                    <p className="text-xs text-muted-foreground" suppressHydrationWarning>{conversations.length} conversation(s)</p>
                </div>
                <ScrollArea className="flex-1">
                    <div className="flex flex-col p-2 gap-2">
                        {conversations.map((conv) => {
                            const contactName = (conv.contact.attributes as any)?.name || 'Unknown Contact';
                            const isSelected = selectedChatId === conv.id;

                            return (
                                <Link
                                    key={conv.id}
                                    href={`?chatId=${conv.id}`}
                                    className="block"
                                >
                                    <div className={`
                                        p-4 rounded-lg cursor-pointer transition-all duration-200
                                        ${isSelected ? 'bg-accent shadow-sm ring-1 ring-border' : 'hover:bg-accent/50'}
                                    `}>
                                        <div className="flex items-center gap-4">
                                            <Avatar className="h-10 w-10 border">
                                                <AvatarFallback className="bg-primary/5 text-primary">
                                                    {contactName.charAt(0).toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <p className={`text-sm truncate ${isSelected ? 'font-bold' : 'font-semibold'}`}>
                                                        {contactName}
                                                    </p>
                                                    <span className="text-[10px] text-muted-foreground" suppressHydrationWarning>
                                                        {conv.updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                                    <span className={`inline-block h-2 w-2 rounded-full ${conv.status === 'OPEN' ? 'bg-green-500' : 'bg-slate-400'}`}></span>
                                                    {conv.status}
                                                </p>
                                                {conv.workspace && (
                                                    <div className="mt-1 flex items-center gap-1">
                                                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex items-center gap-1 border border-gray-200">
                                                            <span className="font-semibold text-gray-800">{(conv.workspace as any).tenantOrg?.name}</span>
                                                            <span className="text-gray-400 opacity-70">•</span>
                                                            <span>{conv.workspace.name}</span>
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </ScrollArea>
            </div>

            {/* ChatWindow */}
            <div className="flex-1 flex flex-col bg-background relative">
                {selectedChatId ? (
                    <>
                        {/* Sticky Header */}
                        <div className="p-4 border-b flex items-center justify-between bg-background/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
                            <div className="flex items-center">
                                <Avatar className="h-8 w-8 mr-3">
                                    <AvatarFallback>
                                        {(currentConversation?.contact.attributes as any)?.name?.charAt(0)}
                                    </AvatarFallback>
                                </Avatar>
                                <span className="font-bold text-lg mr-3">
                                    {(currentConversation?.contact.attributes as any)?.name}
                                </span>
                                {currentConversation?.workspace && (
                                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded border border-gray-200 flex items-center gap-1">
                                        <span className="font-bold text-gray-800">{currentConversation.workspace.tenantOrg?.name}</span>
                                        <span className="text-gray-400 opacity-70">•</span>
                                        <span>{currentConversation.workspace.name}</span>
                                    </span>
                                )}
                            </div>

                            <AiToggleButton
                                conversationId={selectedChatId}
                                initialStatus={currentConversation?.aiStatus || 'ON'}
                            />
                        </div>

                        <ScrollArea className="flex-1 p-6 pb-24">
                            <div className="flex flex-col gap-6 max-w-3xl mx-auto">
                                {messages.map((msg) => {
                                    const isContact = msg.senderType === 'USER';
                                    const isAgent = msg.senderType === 'AGENT';
                                    const isBot = msg.senderType === 'BOT';

                                    return (
                                        <div
                                            key={msg.id}
                                            className={`flex ${isContact ? 'justify-start' : 'justify-end'}`}
                                        >
                                            <div
                                                className={`
                                                    max-w-[75%] px-4 py-2.5 shadow-sm text-sm
                                                    ${isContact
                                                        ? 'bg-gray-100 text-slate-900 rounded-2xl rounded-tl-none border'
                                                        : isAgent
                                                            ? 'bg-emerald-600 text-white rounded-2xl rounded-tr-none'
                                                            : 'bg-blue-600 text-white rounded-2xl rounded-tr-none'
                                                    }
                                                `}
                                            >
                                                {isAgent && (
                                                    <p className="text-[10px] font-bold mb-1 opacity-80 uppercase tracking-wider">Agent</p>
                                                )}
                                                {isBot && (
                                                    <p className="text-[10px] font-bold mb-1 opacity-80 uppercase tracking-wider">AI Assistant</p>
                                                )}
                                                <p className="whitespace-pre-wrap leading-relaxed">
                                                    {msg.contentText}
                                                </p>
                                                <p className={`text-[10px] mt-1.5 opacity-70 ${isContact ? 'text-slate-500' : 'text-blue-50'}`} suppressHydrationWarning>
                                                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>

                        {/* AI Suggestion + Message Input (Client Component) */}
                        <ChatInputWithSuggestion
                            conversationId={selectedChatId}
                            suggestedReply={messages.filter(m => m.senderType === 'USER').pop()?.suggestedReply}
                        />
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-muted/5 gap-4">
                        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                            <span className="text-2xl text-muted-foreground/50 italic">V</span>
                        </div>
                        <p className="text-lg font-medium">Select a conversation to start chatting</p>
                    </div>
                )}
            </div>
        </div>
    );
}
