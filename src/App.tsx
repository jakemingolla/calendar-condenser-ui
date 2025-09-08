import "./index.css";
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import confetti from "canvas-confetti";

// Type definitions based on the OpenAPI schema
interface User {
  id: string;
  given_name: string;
  timezone: string;
  avatar_url: string;
  preffered_working_hours?: [number, number];
}

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  invitees: any[];
}

interface Calendar {
  id: string;
  name: string;
  owner: string;
  created_at: string;
  updated_at: string;
  events?: CalendarEvent[];
}

// New response interfaces based on the updated OpenAPI schema
interface LoadUserResponse {
  type: string;
  user: User;
}

interface LoadCalendarResponse {
  type: string;
  calendar: Calendar;
}

interface LoadInviteesResponse {
  type: string;
  invitees: User[];
  invitee_calendars: Record<string, Calendar>;
}

interface GetReschedulingProposalsResponse {
  type: string;
  pending_rescheduling_proposals: PendingRescheduledEvent[];
}

interface PendingRescheduledEvent {
  type: string;
  original_event: CalendarEvent;
  new_start_time: string;
  new_end_time: string;
  explanation: string;
}

interface SendMessageResponse {
  type: string;
  sent_message: OutgoingMessage;
}

interface ReceiveMessageResponse {
  type: string;
  received_message: IncomingMessage;
}

interface AnalyzeMessageResponse {
  type: string;
  message_analysis: "positive" | "negative" | "unknown";
}

interface OutgoingMessage {
  platform_id: "slack" | "microsoft-teams";
  content: string;
  sent_at: string;
  from_user: User;
  to_user: User;
}

interface IncomingMessage {
  platform_id: "slack" | "microsoft-teams";
  content: string;
  sent_at: string;
  from_user: User;
  to_user: User;
}

// Subgraph message tracking interfaces
interface SubgraphMessageStatus {
  uuid: string;
  toUser: User;
  fromUser: User;
  platform: "slack" | "microsoft-teams";
  sent?: OutgoingMessage;
  received?: IncomingMessage;
  analyzed?: AnalyzeMessageResponse;
}

interface SubgraphMessageStates {
  [uuid: string]: SubgraphMessageStatus;
}

// Conversation interfaces
interface ConversationMessage {
  platform_id: "slack" | "microsoft-teams";
  content: string;
  sent_at: string;
  from_user: User;
  to_user: User;
}

interface InvokeSendReschedulingProposalResponse {
  type: "InvokeSendReschedulingProposalResponse";
  conversations_by_invitee: {
    [inviteeId: string]: ConversationMessage[];
  };
}

interface ConversationState {
  [inviteeId: string]: ConversationMessage[];
}

// State key types for the new stream format
type StateKey = 
  | "$.load_user"
  | "$.introduction"
  | "$.confirm_start"
  | "$.load_calendar"
  | "$.summarize_calendar"
  | "$.load_invitees"
  | "$.before_rescheduling_proposals"
  | "$.get_rescheduling_proposals"
  | "$.confirm_rescheduling_proposals"
  | "$.invoke_send_rescheduling_proposal_to_invitee"
  | "$.load_calendar_after_update"
  | "$.conclusion";

// Accumulated state interface
interface AccumulatedState {
  user?: User;
  date?: string;
  calendar?: Calendar;
  invitees?: User[];
  invitee_calendars?: Record<string, Calendar>;
  pending_rescheduling_proposals?: PendingRescheduledEvent[];
  completed_rescheduling_proposals?: any[];
  conversations?: Record<string, (OutgoingMessage | IncomingMessage)[]>;
}

// New interfaces for interrupt handling
interface Interrupt {
  type: "interrupt";
  value: string;
  id: string;
}

interface Resume {
  type: "resume";
  value: string;
  id: string;
}

interface LoadingIndicator {
  type: "loading";
  message: string;
}

// Timeline item interface
interface TimelineItem {
  id: string;
  timestamp: number;
  type: "ai_message" | "state_update" | "interrupt" | "response" | "subgraph_status" | "loading";
  content: any;
  stateKey?: StateKey; // For state updates, track the state key
  messageId?: string; // For AI messages, track the message ID to group chunks
  responseType?: string; // For responses, track the response type
  subgraphUuid?: string; // For subgraph status items, track the subgraph UUID
}

// Function to generate a random UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper function to remove the last loading indicator from timeline
const removeLastLoadingIndicator = (timeline: TimelineItem[]): TimelineItem[] => {
  // Find the last loading indicator
  const lastLoadingIndex = timeline.findLastIndex(item => item.type === "loading");
  if (lastLoadingIndex !== -1) {
    return timeline.filter((_, index) => index !== lastLoadingIndex);
  }
  return timeline;
};

// Helper function to add timeline item and remove any existing loading indicators
const addTimelineItem = (timeline: TimelineItem[], newItem: TimelineItem): TimelineItem[] => {
  const timelineWithoutLoading = removeLastLoadingIndicator(timeline);
  return [...timelineWithoutLoading, newItem];
};

// Custom hook for relative time formatting
const useRelativeTime = (timestamp: string) => {
  const [relativeTime, setRelativeTime] = useState('');

  const updateRelativeTime = useCallback(() => {
    const now = new Date();
    const messageTime = new Date(timestamp);
    const diffInSeconds = Math.floor((now.getTime() - messageTime.getTime()) / 1000);

    if (diffInSeconds < 60) {
      setRelativeTime(`${diffInSeconds}s`);
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      setRelativeTime(`${minutes}m`);
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      setRelativeTime(`${hours}h`);
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      setRelativeTime(`${days}d`);
    }
  }, [timestamp]);

  useEffect(() => {
    updateRelativeTime();
    const interval = setInterval(updateRelativeTime, 15000); // Update every 15 seconds
    return () => clearInterval(interval);
  }, [updateRelativeTime]);

  return relativeTime;
};

// Message Component with relative time
const MessageComponent = ({ 
  message, 
  isFromAgent, 
  agentUser, 
  inviteeUser 
}: { 
  message: ConversationMessage; 
  isFromAgent: boolean; 
  agentUser: User; 
  inviteeUser: User; 
}) => {
  const relativeTime = useRelativeTime(message.sent_at);

  return (
    <div className={`flex ${isFromAgent ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex items-start space-x-2 max-w-[80%] ${isFromAgent ? 'flex-row' : 'flex-row-reverse space-x-reverse'}`}>
        <img
          src={message.from_user.avatar_url}
          alt={`${message.from_user.given_name}'s avatar`}
          className="w-6 h-6 rounded-full object-cover flex-shrink-0"
          onError={(e) => {
            e.currentTarget.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTY0IDY0QzY3LjMxMzcgNjQgNzAgNjEuMzEzNyA3MCA1OEM3MCA1NC42ODYzIDY3LjMxMzcgNTIgNjQgNTJDNjAuNjg2MyA1MiA1OCA1NC42ODYzIDU4IDU4QzU4IDYxLjMxMzcgNjAuNjg2MyA2NCA2NCA2NFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTY0IDY2QzU2LjI2ODcgNjYgNTAgNzIuMjY4NyA1MCA4MEg3OEM3OCA3Mi4yNjg3IDcxLjczMTMgNjYgNjQgNjZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=";
          }}
        />
        <div className={`flex-1 min-w-0 ${isFromAgent ? 'text-left' : 'text-right'}`}>
          <div className={`text-xs text-gray-500 mb-1 ${isFromAgent ? 'text-left' : 'text-right'}`}>
            {message.from_user.given_name} • {relativeTime}
          </div>
          <div className={`text-sm text-gray-900 break-words p-2 rounded-lg ${
            isFromAgent 
              ? 'bg-blue-100 text-blue-900' 
              : 'bg-gray-100 text-gray-900'
          }`}>
            {message.content}
          </div>
        </div>
      </div>
    </div>
  );
};

// Conversation Tooltip Component
const ConversationTooltip = ({ 
  conversation, 
  isVisible, 
  position,
  agentUser,
  inviteeUser
}: { 
  conversation: ConversationMessage[]; 
  isVisible: boolean; 
  position: { x: number; y: number };
  agentUser: User;
  inviteeUser: User;
}) => {
  if (!isVisible || conversation.length === 0) return null;

  return (
    <div 
      className="fixed z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-4 max-w-sm"
      style={{
        left: position.x,
        top: position.y - 10, // Add 10px margin above the element
        transform: 'translate(-50%, -100%)'
      }}
    >
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {conversation.map((message, index) => {
          const isFromAgent = message.from_user.id === agentUser.id;
          return (
            <MessageComponent
              key={index}
              message={message}
              isFromAgent={isFromAgent}
              agentUser={agentUser}
              inviteeUser={inviteeUser}
            />
          );
        })}
      </div>
    </div>
  );
};

// Loading Indicator Component
const LoadingIndicatorComponent = ({ message }: { message: string }) => {
  return (
    <div className="p-3 text-center mb-3">
      <div className="relative">
        {/* Animated gradient rectangle */}
        <div 
          className="w-full h-16 rounded-lg bg-gradient-to-r from-gray-300 via-gray-200 to-gray-100 animate-pulse"
          style={{
            background: 'linear-gradient(90deg, #d1d5db 0%, #e5e7eb 50%, #f3f4f6 100%)',
            backgroundSize: '200% 100%',
            animation: 'gradient-shift 2s ease-in-out infinite'
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-gray-600 text-sm font-medium">{message}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Global confetti trigger tracking
let confettiTriggered = false;

// Confetti trigger function
const triggerConfetti = () => {
  if (confettiTriggered) {
    console.log('Confetti already triggered, skipping');
    return;
  }
  
  console.log('Triggering confetti...');
  confettiTriggered = true;
  
  // Add a delay to ensure the calendar is rendered
  setTimeout(() => {
    // Get the calendar element to position confetti around it
    // Look for the most recent calendar element (last one in the DOM)
    const calendarElements = document.querySelectorAll('[data-calendar-container]');
    const calendarElement = calendarElements[calendarElements.length - 1];
    console.log('Calendar elements found:', calendarElements.length);
    console.log('Using last calendar element:', !!calendarElement);
    
    if (calendarElement) {
      const rect = calendarElement.getBoundingClientRect();
      console.log('Calendar rect:', rect);
      
      // Check if the calendar is visible on screen (more lenient check)
      const isVisible = rect.bottom > 0 && rect.top < window.innerHeight && 
                       rect.right > 0 && rect.left < window.innerWidth;
      
      console.log('Calendar visibility check:', {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth,
        isVisible
      });
      
      if (isVisible) {
        const centerX = (rect.left + rect.right) / 2;
        const centerY = (rect.top + rect.bottom) / 2;
        const leftX = rect.left;
        const rightX = rect.right;
        
        // Convert to normalized coordinates (0-1)
        const centerXNorm = centerX / window.innerWidth;
        const centerYNorm = centerY / window.innerHeight;
        const leftXNorm = leftX / window.innerWidth;
        const rightXNorm = rightX / window.innerWidth;
        
        console.log('Confetti positions:', { centerXNorm, centerYNorm, leftXNorm, rightXNorm });
        
        // Main burst from the center of the calendar
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { x: centerXNorm, y: centerYNorm }
        });

        // Side bursts (left and right)
        setTimeout(() => {
          confetti({
            particleCount: 50,
            angle: 45,
            spread: 45,
            origin: { x: leftXNorm, y: centerYNorm }
          });
          confetti({
            particleCount: 50,
            angle: 135,
            spread: 45,
            origin: { x: rightXNorm, y: centerYNorm }
          });
        }, 300);
      } else {
        console.log('Calendar is off-screen, looking for visible calendar elements');
        
        // Try to find a visible calendar element instead
        const visibleCalendars = document.querySelectorAll('[data-calendar-container]');
        let visibleCalendar = null;
        
        // Start from the last calendar (most recent) and work backwards
        for (let i = visibleCalendars.length - 1; i >= 0; i--) {
          const cal = visibleCalendars[i];
          const calRect = cal.getBoundingClientRect();
          const isCalVisible = calRect.bottom > 0 && calRect.top < window.innerHeight && 
                              calRect.right > 0 && calRect.left < window.innerWidth;
          if (isCalVisible) {
            visibleCalendar = cal;
            console.log('Found visible calendar (index', i, '):', calRect);
            break;
          }
        }
        
        if (visibleCalendar) {
          const rect = visibleCalendar.getBoundingClientRect();
          const centerX = (rect.left + rect.right) / 2;
          const centerY = (rect.top + rect.bottom) / 2;
          const leftX = rect.left;
          const rightX = rect.right;
          
          const centerXNorm = centerX / window.innerWidth;
          const centerYNorm = centerY / window.innerHeight;
          const leftXNorm = leftX / window.innerWidth;
          const rightXNorm = rightX / window.innerWidth;
          
          console.log('Using visible calendar for confetti:', { centerXNorm, centerYNorm, leftXNorm, rightXNorm });
          
          // Main burst from the center of the calendar
          confetti({
            particleCount: 80,
            spread: 60,
            origin: { x: centerXNorm, y: centerYNorm }
          });

          // Side bursts (left and right)
          console.log('Triggering side bursts');
          setTimeout(() => {
            confetti({
              particleCount: 50,
              angle: 45,
              spread: 45,
              origin: { x: leftXNorm, y: centerYNorm }
            });
            confetti({
              particleCount: 50,
              angle: 135,
              spread: 45,
              origin: { x: rightXNorm, y: centerYNorm }
            });
          }, 300);
        } else {
          console.log('No visible calendar found, using center positioning');
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
          });
        }
      }
    } else {
      console.log('Calendar element not found, using fallback');
      // Fallback to center screen if calendar element not found
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  }, 500); // Delay to ensure DOM is updated
};

// Message Status Component
const MessageStatusComponent = ({ 
  status, 
  conversation 
}: { 
  status: SubgraphMessageStatus; 
  conversation?: ConversationMessage[] 
}) => {
  const { uuid, toUser, platform, sent, received, analyzed } = status;
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    // Only show tooltip if analysis is complete and conversation exists
    if (analyzed && conversation && conversation.length > 0) {
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPosition({
          x: rect.left + rect.width / 2,
          y: rect.top
        });
        setShowTooltip(true);
      }
    }
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };
  
  // Platform logo component
  const PlatformLogo = ({ platform }: { platform: "slack" | "microsoft-teams" }) => {
    if (platform === "slack") {
      return (
        <div className="w-4 h-4 flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 127 127" xmlns="http://www.w3.org/2000/svg">
            <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A"/>
            <path d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0"/>
            <path d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z" fill="#2EB67D"/>
            <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E"/>
          </svg>
        </div>
      );
    } else {
      return (
        <div className="w-4 h-4 flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <path d="M 62.652344 60.660156 L 62.652344 44.929688 C 62.652344 44.539062 62.792969 44.203125 63.074219 43.925781 C 63.359375 43.648438 63.699219 43.507812 64.101562 43.507812 L 80.359375 43.507812 C 80.726562 43.507812 81.082031 43.578125 81.421875 43.714844 C 81.761719 43.851562 82.058594 44.050781 82.320312 44.304688 C 82.578125 44.558594 82.78125 44.851562 82.921875 45.1875 C 83.0625 45.519531 83.132812 45.863281 83.132812 46.226562 L 83.132812 60.660156 C 83.132812 61.316406 83.066406 61.964844 82.9375 62.609375 C 82.804688 63.253906 82.613281 63.878906 82.355469 64.484375 C 82.097656 65.089844 81.785156 65.664062 81.414062 66.210938 C 81.039062 66.757812 80.617188 67.261719 80.144531 67.726562 C 79.671875 68.191406 79.15625 68.605469 78.597656 68.96875 C 78.039062 69.332031 77.453125 69.640625 76.832031 69.894531 C 76.214844 70.144531 75.578125 70.332031 74.917969 70.460938 C 74.261719 70.589844 73.597656 70.652344 72.929688 70.652344 L 72.855469 70.652344 C 72.183594 70.652344 71.519531 70.589844 70.863281 70.460938 C 70.207031 70.332031 69.566406 70.144531 68.949219 69.894531 C 68.328125 69.640625 67.742188 69.332031 67.183594 68.96875 C 66.628906 68.605469 66.113281 68.191406 65.640625 67.726562 C 65.164062 67.261719 64.742188 66.757812 64.371094 66.210938 C 63.996094 65.664062 63.683594 65.089844 63.425781 64.484375 C 63.171875 63.878906 62.976562 63.253906 62.847656 62.609375 C 62.714844 61.964844 62.652344 61.316406 62.652344 60.660156 Z M 62.652344 60.660156 " fill="#1F3A7A"/>
            <path d="M 79.519531 33.476562 C 79.519531 33.902344 79.476562 34.324219 79.390625 34.742188 C 79.304688 35.160156 79.179688 35.566406 79.011719 35.960938 C 78.847656 36.355469 78.640625 36.730469 78.402344 37.082031 C 78.160156 37.4375 77.882812 37.765625 77.578125 38.066406 C 77.269531 38.367188 76.933594 38.636719 76.574219 38.875 C 76.210938 39.109375 75.828125 39.3125 75.425781 39.472656 C 75.023438 39.636719 74.609375 39.761719 74.183594 39.84375 C 73.757812 39.925781 73.328125 39.96875 72.890625 39.96875 C 72.457031 39.96875 72.023438 39.925781 71.597656 39.84375 C 71.171875 39.761719 70.757812 39.636719 70.355469 39.472656 C 69.953125 39.3125 69.570312 39.109375 69.210938 38.875 C 68.847656 38.636719 68.511719 38.367188 68.207031 38.066406 C 67.898438 37.765625 67.625 37.4375 67.382812 37.082031 C 67.140625 36.730469 66.9375 36.355469 66.769531 35.960938 C 66.601562 35.566406 66.476562 35.160156 66.390625 34.742188 C 66.308594 34.324219 66.265625 33.902344 66.265625 33.476562 C 66.265625 33.050781 66.308594 32.628906 66.390625 32.210938 C 66.476562 31.792969 66.601562 31.386719 66.769531 30.992188 C 66.9375 30.597656 67.140625 30.226562 67.382812 29.871094 C 67.625 29.515625 67.898438 29.1875 68.207031 28.886719 C 68.511719 28.585938 68.847656 28.316406 69.210938 28.078125 C 69.570312 27.84375 69.953125 27.644531 70.355469 27.480469 C 70.757812 27.316406 71.171875 27.195312 71.597656 27.109375 C 72.023438 27.027344 72.457031 26.984375 72.890625 26.984375 C 73.328125 26.984375 73.757812 27.027344 74.183594 27.109375 C 74.609375 27.195312 75.023438 27.316406 75.425781 27.480469 C 75.828125 27.644531 76.210938 27.84375 76.574219 28.078125 C 76.933594 28.316406 77.269531 28.585938 77.578125 28.886719 C 77.882812 29.1875 78.160156 29.515625 78.402344 29.871094 C 78.640625 30.226562 78.847656 30.597656 79.011719 30.992188 C 79.179688 31.386719 79.304688 31.792969 79.390625 32.210938 C 79.476562 32.628906 79.519531 33.050781 79.519531 33.476562 Z M 79.519531 33.476562 " fill="#1F3A7A"/>
          </svg>
        </div>
      );
    }
  };

  return (
    <>
      <div 
        ref={cardRef}
        className={`p-3 bg-white rounded-lg border shadow-sm w-64 flex-shrink-0 transition-shadow ${
          analyzed ? 'cursor-pointer hover:shadow-md' : 'cursor-default'
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
      <div className="flex items-center space-x-3">
        {/* User Avatar */}
        <img
          src={toUser.avatar_url}
          alt={`${toUser.given_name}'s avatar`}
          className="w-10 h-10 rounded-full object-cover border-2 border-gray-300"
          onError={(e) => {
            e.currentTarget.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTY0IDY0QzY3LjMxMzcgNjQgNzAgNjEuMzEzNyA3MCA1OEM3MCA1NC42ODYzIDY3LjMxMzcgNTIgNjQgNTJDNjAuNjg2MyA1MiA1OCA1NC42ODYzIDU4IDU4QzU4IDYxLjMxMzcgNjAuNjg2MyA2NCA2NCA2NFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTY0IDY2QzU2LjI2ODcgNjYgNTAgNzIuMjY4NyA1MCA4MEg3OEM3OCA3Mi4yNjg3IDcxLjczMTMgNjYgNjQgNjZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=";
          }}
        />
        
        {/* Platform Logo */}
        <PlatformLogo platform={platform} />
        
        {/* User Name */}
        <div className="font-medium text-gray-900 text-sm">{toUser.given_name}</div>
      </div>
      
      {/* Status Steps */}
      <div className="mt-3 space-y-2">
        {/* Message Sent */}
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 flex-shrink-0">
            {sent ? (
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <div className="w-4 h-4 border-2 border-gray-300 rounded-full"></div>
            )}
          </div>
          <span className={`text-sm ${sent ? 'text-gray-500' : 'text-gray-900'}`}>
            Message sent
          </span>
        </div>
        
        {/* Message Received */}
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 flex-shrink-0">
            {received ? (
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            ) : sent ? (
              <div className="w-4 h-4 border-2 border-gray-400 rounded-full"></div>
            ) : (
              <div className="w-4 h-4 border-2 border-gray-300 rounded-full"></div>
            )}
          </div>
          <span className={`text-sm ${received ? 'text-gray-500' : sent ? 'text-gray-900' : 'text-gray-400'}`}>
            Message received
          </span>
        </div>
        
        {/* Message Analyzed */}
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 flex-shrink-0">
            {analyzed ? (
              <div className="w-4 h-4 flex items-center justify-center">
                {analyzed.message_analysis === "positive" ? (
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : analyzed.message_analysis === "negative" ? (
                  <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <div className="w-4 h-4 border-2 border-yellow-500 rounded-full"></div>
                )}
              </div>
            ) : received ? (
              <div className="w-4 h-4 border-2 border-gray-400 rounded-full"></div>
            ) : (
              <div className="w-4 h-4 border-2 border-gray-300 rounded-full"></div>
            )}
          </div>
          <span className={`text-sm ${analyzed ? 'text-gray-500' : received ? 'text-gray-900' : 'text-gray-400'}`}>
            {analyzed ? (
              analyzed.message_analysis === "positive" ? "Accepted rescheduling" :
              analyzed.message_analysis === "negative" ? "Rejected rescheduling" :
              "Analyzing message"
            ) : received ? "Analyzing message" : "Message analyzed"}
          </span>
        </div>
      </div>
      
      {/* Hover to view text - only show when message has been analyzed and conversation exists */}
      {analyzed && conversation && conversation.length > 0 && (
        <div className="mt-2 text-center">
          <span className="text-xs text-gray-400 italic">(Hover to view)</span>
        </div>
      )}
      </div>
      
      {/* Conversation Tooltip */}
      {conversation && (
        <ConversationTooltip
          conversation={conversation}
          isVisible={showTooltip}
          position={tooltipPosition}
          agentUser={status.fromUser} // The agent is the one sending messages
          inviteeUser={status.toUser} // The invitee is the recipient
        />
      )}
    </>
  );
};

export function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [accumulatedState, setAccumulatedState] = useState<AccumulatedState>({});
  const [inviteeUsers, setInviteeUsers] = useState<Record<string, User>>({});
  const [seenStateKeys, setSeenStateKeys] = useState<Set<StateKey>>(new Set());
  const [waitingForNextState, setWaitingForNextState] = useState(false);
  const [currentInterrupt, setCurrentInterrupt] = useState<Interrupt | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [selectedInterruptOptions, setSelectedInterruptOptions] = useState<Record<string, string>>({});
  const [subgraphMessages, setSubgraphMessages] = useState<SubgraphMessageStates>({});
  const [conversations, setConversations] = useState<ConversationState>({});
  const seenStateIdsRef = useRef<Set<string>>(new Set());
  const [threadId] = useState<string>(() => generateUUID());
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // Generate thread_id once at startup
  useEffect(() => {
    // Thread ID generated
  }, [threadId]);

  // Auto-scroll to bottom when timeline updates or subgraph messages change
  useEffect(() => {
    if (timelineContainerRef.current && (timeline.length > 0 || Object.keys(subgraphMessages).length > 0)) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        if (timelineContainerRef.current) {
          timelineContainerRef.current.scrollTo({
            top: timelineContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 100);
    }
  }, [timeline, subgraphMessages]);

  // Function to fetch user information for invitees
  const fetchInviteeUser = async (userId: string) => {
    if (inviteeUsers[userId]) return; // Already fetched

    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/users/${userId}`
      );
      if (response.ok) {
        const userData = await response.json();
        setInviteeUsers((prev) => ({ ...prev, [userId]: userData }));
      }
    } catch (error) {
      console.error(`Failed to fetch user ${userId}:`, error);
    }
  };

  // Function to handle accepting a rescheduling proposal
  const handleAcceptRescheduling = async (proposal: any, index: number) => {
    // TODO: Implement API call to accept the proposal
    // For now, just log the action
    alert(`Accepted rescheduling for: ${proposal.original_event?.title}`);
  };

  // Function to handle rejecting a rescheduling proposal
  const handleRejectRescheduling = async (proposal: any, index: number) => {
    // TODO: Implement API call to reject the proposal
    // For now, just log the action
    alert(`Rejected rescheduling for: ${proposal.original_event?.title}`);
  };

  // Helper function to update accumulated state based on state key
  const updateAccumulatedState = (stateKey: StateKey, data: any) => {
    setAccumulatedState(prev => {
      const newState = { ...prev };
      
      switch (stateKey) {
        case "$.load_user":
          if (data && data.user) {
            newState.user = data.user;
          }
          break;
        case "$.load_calendar":
          if (data && data.calendar) {
            newState.calendar = data.calendar;
            // Only set user from calendar if we don't already have user data
            if (!newState.user && data.calendar.owner) {
              newState.user = { 
                id: data.calendar.owner,
                given_name: "User",
                timezone: "UTC",
                avatar_url: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTY0IDY0QzY3LjMxMzcgNjQgNzAgNjEuMzEzNyA3MCA1OEM3MCA1NC42ODYzIDY3LjMxMzcgNTIgNjQgNTJDNjAuNjg2MyA1MiA1OCA1NC42ODYzIDU4IDU4QzU4IDYxLjMxMzcgNjAuNjg2MyA2NCA2NCA2NFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTY0IDY2QzU2LjI2ODcgNjYgNTAgNzIuMjY4NyA1MCA4MEg3OEM3OCA3Mi4yNjg3IDcxLjczMTMgNjYgNjQgNjZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=",
                preffered_working_hours: [9, 17]
              } as User;
            }
          }
          break;
        case "$.load_calendar_after_update":
          if (data && data.calendar) {
            newState.calendar = data.calendar;
            // Clear pending proposals since events have been updated
            newState.pending_rescheduling_proposals = [];
            // Only set user from calendar if we don't already have user data
            if (!newState.user && data.calendar.owner) {
              newState.user = { 
                id: data.calendar.owner,
                given_name: "User",
                timezone: "UTC",
                avatar_url: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTY0IDY0QzY3LjMxMzcgNjQgNzAgNjEuMzEzNyA3MCA1OEM3MCA1NC42ODYzIDY3LjMxMzcgNTIgNjQgNTJDNjAuNjg2MyA1MiA1OCA1NC42ODYzIDU4IDU4QzU4IDYxLjMxMzcgNjAuNjg2MyA2NCA2NCA2NFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTY0IDY2QzU2LjI2ODcgNjYgNTAgNzIuMjY4NyA1MCA4MEg3OEM3OCA3Mi4yNjg3IDcxLjczMTMgNjYgNjQgNjZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=",
                preffered_working_hours: [9, 17]
              } as User;
            }
          }
          break;
        case "$.load_invitees":
          if (data && data.invitees) {
            newState.invitees = data.invitees;
            newState.invitee_calendars = data.invitee_calendars || {};
          }
          break;
        case "$.get_rescheduling_proposals":
          if (data && data.pending_rescheduling_proposals) {
            newState.pending_rescheduling_proposals = data.pending_rescheduling_proposals;
          }
          break;
        // Add other state keys as needed
        default:
          // Unhandled state key
          break;
      }
      
      return newState;
    });
  };

  // Helper function to process conversation responses
  const processConversationResponse = (data: InvokeSendReschedulingProposalResponse) => {
    setConversations(prev => ({
      ...prev,
      ...data.conversations_by_invitee
    }));
  };

  // Helper function to process subgraph message responses
  const processSubgraphMessageResponse = (data: any, responseType: string) => {
    // Extract UUID from the response type pattern
    // Pattern: $.invoke_send_rescheduling_proposal_to_invitee:[uuid].send_message
    const uuidMatch = responseType.match(/\.invoke_send_rescheduling_proposal_to_invitee:([^.]+)\.(.+)/);
    if (!uuidMatch) return;
    
    const [, uuid, stage] = uuidMatch;
    
    setSubgraphMessages(prev => {
      const updated = { ...prev };
      
      if (!updated[uuid]) {
        // Initialize subgraph message status
        updated[uuid] = {
          uuid,
          toUser: data.sent_message?.to_user || data.received_message?.to_user || { 
            id: '', 
            given_name: 'Unknown', 
            timezone: 'UTC', 
            avatar_url: '', 
            preffered_working_hours: [9, 17] 
          },
          fromUser: data.sent_message?.from_user || data.received_message?.from_user || { 
            id: '', 
            given_name: 'Unknown', 
            timezone: 'UTC', 
            avatar_url: '', 
            preffered_working_hours: [9, 17] 
          },
          platform: data.sent_message?.platform_id || data.received_message?.platform_id || 'slack'
        };
      }
      
      // Update the appropriate stage
      switch (stage) {
        case 'send_message':
          if (data.sent_message) {
            updated[uuid].sent = data.sent_message;
          }
          break;
        case 'receive_message':
          if (data.received_message) {
            updated[uuid].received = data.received_message;
          }
          break;
        case 'analyze_message':
          if (data.message_analysis) {
            updated[uuid].analyzed = data;
          }
          break;
      }
      
      return updated;
    });

    // Add subgraph message status to timeline when first created or when analysis is complete
    if (stage === 'send_message' || (stage === 'analyze_message' && data.message_analysis)) {
      setTimeline(prev => {
        // Check if this subgraph already exists in timeline
        const existingIndex = prev.findIndex(item => 
          item.type === 'subgraph_status' && item.subgraphUuid === uuid
        );

        if (existingIndex >= 0) {
          // Update existing timeline item
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            timestamp: Date.now(),
            content: { uuid, stage, data }
          };
          return updated;
        } else {
          // Add new timeline item
          return [
            ...prev,
            {
              id: `subgraph_${uuid}_${Date.now()}`,
              timestamp: Date.now(),
              type: 'subgraph_status' as const,
              content: { uuid, stage, data },
              subgraphUuid: uuid
            }
          ];
        }
      });
    }
  };

  // Helper function to update accumulated state from response objects
  const updateAccumulatedStateFromResponse = (data: any) => {
    setAccumulatedState(prev => {
      const newState = { ...prev };
      
      switch (data.type) {
        case "LoadUserResponse":
          if (data.user) {
            newState.user = data.user;
          }
          break;
        case "LoadCalendarResponse":
          if (data.calendar) {
            newState.calendar = data.calendar;
            // Only set user from calendar if we don't already have user data
            if (!newState.user && data.calendar.owner) {
              newState.user = {
                id: data.calendar.owner,
                given_name: "User",
                timezone: "UTC",
                avatar_url: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTY0IDY0QzY3LjMxMzcgNjQgNzAgNjEuMzEzNyA3MCA1OEM3MCA1NC42ODYzIDY3LjMxMzcgNTIgNjQgNTJDNjAuNjg2MyA1MiA1OCA1NC42ODYzIDU4IDU4QzU4IDYxLjMxMzcgNjAuNjg2MyA2NCA2NCA2NFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTY0IDY2QzU2LjI2ODcgNjYgNTAgNzIuMjY4NyA1MCA4MEg3OEM3OCA3Mi4yNjg3IDcxLjczMTMgNjYgNjQgNjZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=",
                preffered_working_hours: [9, 17]
              } as User;
            }
          }
          break;
        case "LoadInviteesResponse":
          if (data.invitees) {
            newState.invitees = data.invitees;
            newState.invitee_calendars = data.invitee_calendars || {};
          }
          break;
        case "GetReschedulingProposalsResponse":
          if (data.pending_rescheduling_proposals) {
            newState.pending_rescheduling_proposals = data.pending_rescheduling_proposals;
          }
          break;
        case "SendMessageResponse":
          if (data.sent_message) {
            const conversationKey = data.sent_message.to_user.id;
            if (!newState.conversations) {
              newState.conversations = {};
            }
            if (!newState.conversations[conversationKey]) {
              newState.conversations[conversationKey] = [];
            }
            newState.conversations[conversationKey].push(data.sent_message);
            
            // Extract current user from sent message
            if (data.sent_message.from_user) {
              newState.user = data.sent_message.from_user;
            }
          }
          break;
        case "ReceiveMessageResponse":
          if (data.received_message) {
            const conversationKey = data.received_message.from_user.id;
            if (!newState.conversations) {
              newState.conversations = {};
            }
            if (!newState.conversations[conversationKey]) {
              newState.conversations[conversationKey] = [];
            }
            newState.conversations[conversationKey].push(data.received_message);
          }
          break;
        case "AnalyzeMessageResponse":
          // This will be handled by the subgraph message tracking
          break;
        default:
          // Unhandled response type
          break;
      }
      
      return newState;
    });
  };

  // Function to handle resuming from an interrupt
  const handleResume = async (value: string) => {
    if (!currentInterrupt) return;

    setIsResuming(true);
    setSelectedInterruptOptions({ ...selectedInterruptOptions, [currentInterrupt.id]: value });
    setCurrentInterrupt(null);

    try {
      const resumeData: Resume = {
        type: "resume",
        value: value,
        id: currentInterrupt.id
      };

      const response = await fetch(
        `http://localhost:8000/api/v1/graphs/default/threads/${threadId}/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(resumeData),
        }
      );

      if (!response.body) {
        throw new Error("No response body");
      }

      // Process the resumed stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);

            if (data.type === "AIMessageChunk") {
              // Check if this is the final message chunk (finish_reason: stop)
              if (data.response_metadata?.finish_reason === "stop") {
                setWaitingForNextState(true);
              }

              // Reset resuming state when we start processing content
              setIsResuming(false);
              
              // Add or update AI message in timeline using the id field
              setTimeline((prev) => {
                // Remove any existing loading indicators before adding new content
                const timelineWithoutLoading = removeLastLoadingIndicator(prev);
                const messageId = data.id;
                const existingIndex = timelineWithoutLoading.findIndex(
                  (item) =>
                    item.type === "ai_message" && item.messageId === messageId
                );

                if (existingIndex >= 0) {
                  // Update existing AI message by appending content
                  const updated = [...timelineWithoutLoading];
                  updated[existingIndex] = {
                    ...updated[existingIndex],
                    content:
                      updated[existingIndex].content + (data.content || ""),
                    timestamp: Date.now(),
                  };
                  return updated;
                } else {
                  // Create new AI message
                  return addTimelineItem(timelineWithoutLoading, {
                    id: `ai_${messageId}_${Date.now()}`,
                    timestamp: Date.now(),
                    type: "ai_message" as const,
                    content: data.content || "",
                    messageId: messageId,
                  });
                }
              });
            } else if (data.type === "interrupt") {
              // Handle interrupt
              setCurrentInterrupt(data);
              setWaitingForNextState(false);
              
              // Add interrupt to timeline (remove any loading indicators first)
              setTimeline((prev) => addTimelineItem(prev, {
                id: `interrupt_${data.id}_${Date.now()}`,
                timestamp: Date.now(),
                type: "interrupt" as const,
                content: data,
              }));
            } else if (data.type === "loading") {
              // Handle loading indicator
              setWaitingForNextState(false);
              
              // Add loading indicator to timeline (this will replace any existing loading indicator)
              setTimeline((prev) => addTimelineItem(prev, {
                id: `loading_${Date.now()}`,
                timestamp: Date.now(),
                type: "loading" as const,
                content: data,
              }));
            } else {
              // Handle state updates and responses
              const stateKey = Object.keys(data).find(key => key.startsWith('$.')) as StateKey;
              
              if (stateKey) {
                // Check if this is a conversation response
                if (stateKey === '$.invoke_send_rescheduling_proposal_to_invitee') {
                  // This is a conversation response
                  processConversationResponse(data[stateKey]);
                  
                  // Don't add to timeline - conversation data is only used for tooltips
                } else if (stateKey.startsWith('$.invoke_send_rescheduling_proposal_to_invitee:')) {
                  // This is a subgraph message response
                  processSubgraphMessageResponse(data[stateKey], stateKey);
                  
                  // Don't add to timeline - subgraph messages are displayed separately
                  // The MessageStatusComponent will automatically update when subgraphMessages state changes
                } else {
                  // This is a regular state update
                  
                  if (!seenStateKeys.has(stateKey)) {
                    setSeenStateKeys(prev => new Set([...prev, stateKey]));
                    setWaitingForNextState(false);

                    // Only add to timeline if there's actual content (not null)
                    if (data[stateKey] !== null) {
                      setTimeline((prev) => addTimelineItem(prev, {
                        id: `state_${stateKey}_${Date.now()}`,
                        timestamp: Date.now(),
                        type: "state_update" as const,
                        content: data[stateKey],
                        stateKey: stateKey,
                      }));
                    }

                    // Update accumulated state
                    updateAccumulatedState(stateKey, data[stateKey]);
                  }
                }
              } else if (data.type) {
                // This is a response object
                
                setTimeline((prev) => addTimelineItem(prev, {
                  id: `response_${data.type}_${Date.now()}`,
                  timestamp: Date.now(),
                  type: "response" as const,
                  content: data,
                  responseType: data.type,
                }));

                // Update accumulated state based on response type
                updateAccumulatedStateFromResponse(data);
              }
            }
          } catch (e) {
            console.error("Failed to parse JSON:", line);
          }
        }
      }
    } catch (error) {
      console.error("Error resuming:", error);
      // Restore the interrupt if resume failed
      setCurrentInterrupt(currentInterrupt);
    } finally {
      setIsResuming(false);
    }
  };

  const handleStart = async () => {
    setIsStarted(true);
    setTimeline([]);
    setAccumulatedState({});
    setSeenStateKeys(new Set());
    setWaitingForNextState(false);
    setCurrentInterrupt(null);
    setIsResuming(false);
    setSelectedInterruptOptions({});
    setSubgraphMessages({});
    setConversations({});
    seenStateIdsRef.current = new Set();

    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/graphs/default/threads/${threadId}/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);

            if (data.type === "AIMessageChunk") {
              // Check if this is the final message chunk (finish_reason: stop)
              if (data.response_metadata?.finish_reason === "stop") {
                setWaitingForNextState(true);
              }

              // Add or update AI message in timeline using the id field
              setTimeline((prev) => {
                const messageId = data.id;
                const existingIndex = prev.findIndex(
                  (item) =>
                    item.type === "ai_message" && item.messageId === messageId
                );

                if (existingIndex >= 0) {
                  // Update existing AI message by appending content
                  const updated = [...prev];
                  updated[existingIndex] = {
                    ...updated[existingIndex],
                    content:
                      updated[existingIndex].content + (data.content || ""),
                    timestamp: Date.now(),
                  };
                  return updated;
                } else {
                  // Create new AI message
                  return [
                    ...prev,
                    {
                      id: `ai_${messageId}_${Date.now()}`,
                      timestamp: Date.now(),
                      type: "ai_message" as const,
                      content: data.content || "",
                      messageId: messageId,
                    },
                  ];
                }
              });
            } else if (data.type === "interrupt") {
              // Handle interrupt
              setCurrentInterrupt(data);
              setWaitingForNextState(false);
              
              // Add interrupt to timeline (remove any loading indicators first)
              setTimeline((prev) => addTimelineItem(prev, {
                id: `interrupt_${data.id}_${Date.now()}`,
                timestamp: Date.now(),
                type: "interrupt" as const,
                content: data,
              }));
            } else if (data.type === "loading") {
              // Handle loading indicator
              setWaitingForNextState(false);
              
              // Add loading indicator to timeline (this will replace any existing loading indicator)
              setTimeline((prev) => addTimelineItem(prev, {
                id: `loading_${Date.now()}`,
                timestamp: Date.now(),
                type: "loading" as const,
                content: data,
              }));
            } else {
              // Handle state updates and responses
              const stateKey = Object.keys(data).find(key => key.startsWith('$.')) as StateKey;
              
              if (stateKey) {
                // Check if this is a conversation response
                if (stateKey === '$.invoke_send_rescheduling_proposal_to_invitee') {
                  // This is a conversation response
                  processConversationResponse(data[stateKey]);
                  
                  // Don't add to timeline - conversation data is only used for tooltips
                } else if (stateKey.startsWith('$.invoke_send_rescheduling_proposal_to_invitee:')) {
                  // This is a subgraph message response
                  processSubgraphMessageResponse(data[stateKey], stateKey);
                  
                  // Don't add to timeline - subgraph messages are displayed separately
                  // The MessageStatusComponent will automatically update when subgraphMessages state changes
                } else {
                  // This is a regular state update
                  
                  if (!seenStateKeys.has(stateKey)) {
                    setSeenStateKeys(prev => new Set([...prev, stateKey]));
                    setWaitingForNextState(false);

                    // Only add to timeline if there's actual content (not null)
                    if (data[stateKey] !== null) {
                      setTimeline((prev) => addTimelineItem(prev, {
                        id: `state_${stateKey}_${Date.now()}`,
                        timestamp: Date.now(),
                        type: "state_update" as const,
                        content: data[stateKey],
                        stateKey: stateKey,
                      }));
                    }

                    // Update accumulated state
                    updateAccumulatedState(stateKey, data[stateKey]);
                  }
                }
              } else if (data.type) {
                // This is a response object
                
                setTimeline((prev) => addTimelineItem(prev, {
                  id: `response_${data.type}_${Date.now()}`,
                  timestamp: Date.now(),
                  type: "response" as const,
                  content: data,
                  responseType: data.type,
                }));

                // Update accumulated state based on response type
                updateAccumulatedStateFromResponse(data);
              }
            }
          } catch (e) {
            console.error("Failed to parse JSON:", line);
          }
        }
      }
    } catch (error) {
      console.error("Error:", error);
      setIsStarted(false);
    }
  };


  // Render timeline items
  const renderTimelineItem = (item: TimelineItem) => {
    if (item.type === "ai_message") {
      // Handle escaped newlines from backend (convert \n to actual newlines)
      const processedContent = item.content.replace(/\\n/g, "\n");

      return (
        <div
          key={item.id}
          className="p-3 bg-white rounded-lg text-left mb-3 text-sm"
        >
          <div className="ai-message-content">
            <ReactMarkdown>{processedContent}</ReactMarkdown>
          </div>
        </div>
      );
    }

    if (item.type === "interrupt") {
      const interrupt = item.content as Interrupt;
      const isConfirmed = selectedInterruptOptions[interrupt.id] === "CONFIRMED";
      const isRejected = selectedInterruptOptions[interrupt.id] === "REJECTED";
      
      return (
        <div
          key={item.id}
          className="p-4 border border-yellow-200 rounded-lg text-center mb-3 bg-white"
        >
          <div className="flex flex-col items-center">
            <div className="text-yellow-700 text-sm mb-3">
              <ReactMarkdown>{interrupt.value}</ReactMarkdown>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleResume("CONFIRMED")}
                disabled={isResuming || isConfirmed || isRejected}
                className={`px-4 py-2 text-sm rounded-md transition-colors duration-200 font-medium ${
                  isConfirmed
                    ? "bg-gray-500 text-gray-300 cursor-default"
                    : isRejected
                    ? "bg-white text-gray-500 border border-gray-300 cursor-not-allowed"
                    : "bg-green-600 hover:bg-green-700 text-white"
                }`}
              >
                {isConfirmed ? "Confirmed" : isRejected ? "Confirm" : "Confirm"}
              </button>
              <button
                onClick={() => handleResume("REJECTED")}
                disabled={isResuming || isConfirmed || isRejected}
                className={`px-4 py-2 text-sm rounded-md transition-colors duration-200 font-medium ${
                  isRejected
                    ? "bg-gray-500 text-gray-300 cursor-default"
                    : isConfirmed
                    ? "bg-white text-gray-500 border border-gray-300 cursor-not-allowed"
                    : "bg-red-600 hover:bg-red-700 text-white"
                }`}
              >
                {isRejected ? "Rejected" : isConfirmed ? "Reject" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (item.type === "state_update") {
      return (
        <div key={item.id} className="w-full mb-3">
          {renderStateUpdate(item.stateKey!, item.content, item)}
        </div>
      );
    }

    if (item.type === "response") {
      return (
        <div key={item.id} className="w-full mb-3">
          {renderResponse(item.responseType!, item.content, item)}
        </div>
      );
    }

    if (item.type === "loading") {
      const loadingData = item.content as LoadingIndicator;
      return (
        <LoadingIndicatorComponent 
          key={item.id} 
          message={loadingData.message} 
        />
      );
    }

    return null;
  };

  // Render state update based on state key
  const renderStateUpdate = (stateKey: StateKey, content: any, timelineItem: TimelineItem) => {
    if (content === null) {
      // Don't show anything for null state updates - these are internal processing steps
      return null;
    }

    // Build cumulative state up to this timeline item
    const cumulativeState = buildCumulativeState(timelineItem);

    switch (stateKey) {
      case "$.load_user":
        return renderUserUpdate(content);
      case "$.load_calendar":
        return renderCalendarUpdate(content, cumulativeState, stateKey);
      case "$.load_calendar_after_update":
        return renderCalendarUpdate(content, cumulativeState, stateKey);
      case "$.load_invitees":
        return renderInviteesUpdate(content, cumulativeState);
      case "$.get_rescheduling_proposals":
        return renderReschedulingProposalsUpdate(content, cumulativeState);
      default:
        return (
          <div className="p-3 bg-gray-100 rounded-lg text-sm">
            <strong>{getStateKeyDescription(stateKey)}</strong>
            <pre className="text-xs mt-2 overflow-x-auto">
              {JSON.stringify(content, null, 2)}
            </pre>
          </div>
        );
    }
  };

  // Render response based on response type
  const renderResponse = (responseType: string, content: any, timelineItem: TimelineItem) => {
    // Build cumulative state up to this timeline item
    const cumulativeState = buildCumulativeState(timelineItem);

    switch (responseType) {
      case "LoadUserResponse":
        return renderUserUpdate(content);
      case "LoadCalendarResponse":
        return renderCalendarUpdate(content, cumulativeState);
      case "LoadInviteesResponse":
        return renderInviteesUpdate(content, cumulativeState);
      case "GetReschedulingProposalsResponse":
        return renderReschedulingProposalsUpdate(content, cumulativeState);
      case "SendMessageResponse":
        return renderMessageResponse("Sent", content.sent_message);
      case "ReceiveMessageResponse":
        return renderMessageResponse("Received", content.received_message);
      case "AnalyzeMessageResponse":
        return (
          <div className="p-3 bg-blue-50 rounded-lg text-sm">
            <strong>Message Analysis:</strong> {content.message_analysis}
          </div>
        );
      default:
        return (
          <div className="p-3 bg-gray-100 rounded-lg text-sm">
            <strong>{responseType}</strong>
            <pre className="text-xs mt-2 overflow-x-auto">
              {JSON.stringify(content, null, 2)}
            </pre>
          </div>
        );
    }
  };

  // Helper function to get human-readable description of state keys
  const getStateKeyDescription = (stateKey: StateKey): string => {
    switch (stateKey) {
      case "$.load_user": return "Load User";
      case "$.introduction": return "Introduction";
      case "$.confirm_start": return "Confirm Start";
      case "$.load_calendar": return "Load Calendar";
      case "$.summarize_calendar": return "Summarize Calendar";
      case "$.load_invitees": return "Load Invitees";
      case "$.before_rescheduling_proposals": return "Before Rescheduling Proposals";
      case "$.get_rescheduling_proposals": return "Get Rescheduling Proposals";
      case "$.confirm_rescheduling_proposals": return "Confirm Rescheduling Proposals";
      case "$.invoke_send_rescheduling_proposal_to_invitee": return "Send Rescheduling Proposal";
      case "$.load_calendar_after_update": return "Load Calendar After Update";
      case "$.conclusion": return "Conclusion";
      default: return stateKey;
    }
  };

  // Render user update
  const renderUserUpdate = (data: any) => {
    const user = data.user || data;
    if (!user) {
      return null;
    }

    // Helper function to convert 24-hour time to 12-hour AM/PM format
    const formatHour = (hour: number): string => {
      if (hour === 0) return "12 AM";
      if (hour < 12) return `${hour} AM`;
      if (hour === 12) return "12 PM";
      return `${hour - 12} PM`;
    };

    return (
      <div className="p-3 bg-white rounded-lg shadow-sm">
        <div className="flex flex-col items-center space-y-3">
          <img
            src={user.avatar_url}
            alt={`${user.given_name}'s avatar`}
            className="w-12 h-12 rounded-full object-cover border-2 border-blue-500"
            onError={(e) => {
              e.currentTarget.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTY0IDY0QzY3LjMxMzcgNjQgNzAgNjEuMzEzNyA3MCA1OEM3MCA1NC42ODYzIDY3LjMxMzcgNTIgNjQgNTJDNjAuNjg2MyA1MiA1OCA1NC42ODYzIDU4IDU4QzU4IDYxLjMxMzcgNjAuNjg2MyA2NCA2NCA2NFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTY0IDY2QzU2LjI2ODcgNjYgNTAgNzIuMjY4NyA1MCA4MEg3OEM3OCA3Mi4yNjg3IDcxLjczMTMgNjYgNjQgNjZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=";
            }}
          />
          <div className="text-center">
            <div className="font-medium text-gray-900 text-sm">{user.given_name}</div>
            <div className="text-xs text-gray-600">Time zone: {user.timezone}</div>
            <div className="text-xs text-gray-500">
              Working hours: {formatHour(user.preffered_working_hours?.[0] || 9)} - {formatHour(user.preffered_working_hours?.[1] || 17)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render calendar update
  const renderCalendarUpdate = (data: any, cumulativeState: AccumulatedState, stateKey?: StateKey) => {
    const calendar = data.calendar || data;
    if (!calendar || !calendar.events) {
      return null;
    }

    // For load_calendar_after_update, don't show pending proposals since events have been updated
    const pendingProposals = stateKey === "$.load_calendar_after_update" 
      ? [] 
      : cumulativeState.pending_rescheduling_proposals;

    // For load_calendar_after_update, don't show invitees - only show the main user's calendar
    const showInvitees = stateKey !== "$.load_calendar_after_update";
    const invitees = showInvitees ? cumulativeState.invitees : undefined;
    const inviteeCalendars = showInvitees ? cumulativeState.invitee_calendars : undefined;

    // Use the cumulative state up to this timeline item
    return (
      <CalendarDisplay
        calendar={calendar}
        currentUser={cumulativeState.user || {} as User}
        invitees={invitees}
        inviteeCalendars={inviteeCalendars}
        pendingReschedulingProposals={pendingProposals}
        stateKey={stateKey}
      />
    );
  };

  // Render invitees update
  const renderInviteesUpdate = (data: any, cumulativeState: AccumulatedState) => {
    const invitees = data.invitees || [];
    const inviteeCalendars = data.invitee_calendars || {};
    
    if (invitees.length === 0) {
      return null;
    }

    // Show the full calendar view with invitees when they're loaded
    // Use the cumulative state up to this timeline item
    if (cumulativeState.calendar) {
      return (
        <CalendarDisplay
          calendar={cumulativeState.calendar}
          currentUser={cumulativeState.user || {} as User}
          invitees={invitees}
          inviteeCalendars={inviteeCalendars}
          pendingReschedulingProposals={cumulativeState.pending_rescheduling_proposals}
        />
      );
    }

    // Fallback to simple display if no calendar is loaded yet
    return (
      <div className="p-3 bg-white rounded-lg border shadow-sm">
        <h4 className="font-medium text-gray-900 mb-2 text-sm">Invitees Loaded</h4>
        <div className="flex flex-wrap gap-2">
          {invitees.map((invitee: User) => (
            <div key={invitee.id} className="flex items-center space-x-2 bg-gray-50 px-2 py-1 rounded">
              <img
                src={invitee.avatar_url}
                alt={`${invitee.given_name}'s avatar`}
                className="w-6 h-6 rounded-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTY0IDY0QzY3LjMxMzcgNjQgNzAgNjEuMzEzNyA3MCA1OEM3MCA1NC42ODYzIDY3LjMxMzcgNTIgNjQgNTJDNjAuNjg2MyA1MiA1OCA1NC42ODYzIDU4IDU4QzU4IDYxLjMxMzcgNjAuNjg2MyA2NCA2NCA2NFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTY0IDY2QzU2LjI2ODcgNjYgNTAgNzIuMjY4NyA1MCA4MEg3OEM3OCA3Mi4yNjg3IDcxLjczMTMgNjYgNjQgNjZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=";
                }}
              />
              <span className="text-xs font-medium text-gray-700">{invitee.given_name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render rescheduling proposals update
  const renderReschedulingProposalsUpdate = (data: any, cumulativeState: AccumulatedState) => {
    const proposals = data.pending_rescheduling_proposals || [];
    
    if (proposals.length === 0) {
      return (
        <div className="p-3 bg-gray-100 rounded-lg text-center text-sm text-gray-600">
          No rescheduling proposals found
        </div>
      );
    }

    // Show the full calendar view with rescheduling proposals
    // Use the cumulative state up to this timeline item
    if (cumulativeState.calendar) {
      return (
        <>
          <CalendarDisplay
            calendar={cumulativeState.calendar}
            currentUser={cumulativeState.user || {} as User}
            invitees={cumulativeState.invitees}
            inviteeCalendars={cumulativeState.invitee_calendars}
            pendingReschedulingProposals={proposals}
          />
          
          {/* Pending Rescheduling Proposals Details */}
          <div className="mt-4 space-y-2 text-sm text-gray-700">
            {proposals.map((proposal: PendingRescheduledEvent, index: number) => (
              <div key={index} className="p-3 bg-white rounded-lg border shadow-sm">
                <p className="text-sm">
                  <strong>Event:</strong>{" "}
                  <strong>{proposal.original_event?.title || "Unknown Event"}</strong>
                </p>
                <p className="text-sm">
                  <strong>Start Time Change:</strong>{" "}
                  <span className="text-red-600 font-medium">
                    {new Date(proposal.original_event?.start_time).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}
                  </span>
                  {" → "}
                  <span className="text-green-600 font-medium">
                    {new Date(proposal.new_start_time).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}
                  </span>
                </p>
                <p className="text-sm">
                  <strong>End Time Change:</strong>{" "}
                  <span className="text-red-600 font-medium">
                    {new Date(proposal.original_event?.end_time).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}
                  </span>
                  {" → "}
                  <span className="text-green-600 font-medium">
                    {new Date(proposal.new_end_time).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}
                  </span>
                </p>
                <p className="text-sm">
                  <strong>Reason:</strong> <ReactMarkdown>{proposal.explanation}</ReactMarkdown>
                </p>
              </div>
            ))}
          </div>
        </>
      );
    }

    // Fallback to simple display if no calendar is loaded yet
    return (
      <div className="p-3 bg-white rounded-lg border shadow-sm">
        <h4 className="font-medium text-gray-900 mb-2 text-sm">Rescheduling Proposals</h4>
        <div className="space-y-2">
          {proposals.map((proposal: PendingRescheduledEvent, index: number) => (
            <div key={index} className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
              <p><strong>Event:</strong> {proposal.original_event?.title}</p>
              <p><strong>New Time:</strong> {new Date(proposal.new_start_time).toLocaleTimeString()} - {new Date(proposal.new_end_time).toLocaleTimeString()}</p>
              <p><strong>Reason:</strong> <ReactMarkdown>{proposal.explanation}</ReactMarkdown></p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render message response
  const renderMessageResponse = (type: string, message: any) => {
    // Process escaped newlines for markdown
    const processedContent = message.content.replace(/\\n/g, "\n");
    
    return (
      <div className="p-3 bg-blue-50 rounded-lg text-sm">
        <strong>{type} Message:</strong>
        <div className="mt-1">
          <ReactMarkdown>{processedContent}</ReactMarkdown>
        </div>
        <div className="text-xs text-gray-600 mt-1">
          From: {message.from_user?.given_name} → To: {message.to_user?.given_name}
        </div>
      </div>
    );
  };

  // Function to build cumulative state up to a specific timeline item
  const buildCumulativeState = (timelineItem: TimelineItem): AccumulatedState => {
    const state: AccumulatedState = {};
    
    // Find all timeline items up to and including the current one
    const currentIndex = timeline.findIndex(item => item.id === timelineItem.id);
    const relevantItems = timeline.slice(0, currentIndex + 1);
    
    // Process each timeline item to build cumulative state
    for (const item of relevantItems) {
      if (item.type === "state_update" && item.stateKey) {
        
        switch (item.stateKey) {
          case "$.load_user":
            if (item.content?.user) {
              state.user = item.content.user;
            }
            break;
          case "$.load_calendar":
            if (item.content?.calendar) {
              state.calendar = item.content.calendar;
            }
            break;
          case "$.load_calendar_after_update":
            if (item.content?.calendar) {
              state.calendar = item.content.calendar;
              // Clear pending proposals since events have been updated
              state.pending_rescheduling_proposals = [];
            }
            break;
          case "$.load_invitees":
            if (item.content?.invitees) {
              state.invitees = item.content.invitees;
            }
            if (item.content?.invitee_calendars) {
              state.invitee_calendars = item.content.invitee_calendars;
            }
            break;
          case "$.get_rescheduling_proposals":
            if (item.content?.pending_rescheduling_proposals) {
              state.pending_rescheduling_proposals = item.content.pending_rescheduling_proposals;
            }
            break;
        }
      } else if (item.type === "response") {
        
        // Handle response objects that also contain state data
        switch (item.responseType) {
          case "LoadUserResponse":
            if (item.content?.user) {
              state.user = item.content.user;
            }
            break;
          case "LoadCalendarResponse":
            if (item.content?.calendar) {
              state.calendar = item.content.calendar;
            }
            break;
          case "LoadInviteesResponse":
            if (item.content?.invitees) {
              state.invitees = item.content.invitees;
            }
            if (item.content?.invitee_calendars) {
              state.invitee_calendars = item.content.invitee_calendars;
            }
            break;
          case "GetReschedulingProposalsResponse":
            if (item.content?.pending_rescheduling_proposals) {
              state.pending_rescheduling_proposals = item.content.pending_rescheduling_proposals;
            }
            break;
        }
      }
    }
    
    return state;
  };

  // CalendarDisplay component that captures state at render time
  const CalendarDisplay = ({
    calendar,
    currentUser,
    invitees,
    inviteeCalendars,
    pendingReschedulingProposals,
    stateKey
  }: {
    calendar: any;
    currentUser: User;
    invitees?: User[];
    inviteeCalendars?: Record<string, Calendar>;
    pendingReschedulingProposals?: any[];
    stateKey?: StateKey;
  }) => {
    // Use useRef to capture state only once, on first render
    const capturedStateRef = useRef<{
      calendar: any;
      currentUser: User;
      invitees?: User[];
      inviteeCalendars?: Record<string, Calendar>;
      pendingReschedulingProposals?: any[];
    } | null>(null);

    // Trigger confetti for load_calendar_after_update
    useEffect(() => {
      console.log('CalendarDisplay useEffect triggered with stateKey:', stateKey);
      if (stateKey === "$.load_calendar_after_update") {
        console.log('Triggering confetti for load_calendar_after_update');
        triggerConfetti();
      }
    }, [stateKey]);

    // Only capture state if it hasn't been captured yet
    if (!capturedStateRef.current) {
      
      capturedStateRef.current = {
        calendar,
        currentUser,
        invitees,
        inviteeCalendars,
        pendingReschedulingProposals
      };
    }

    return renderTimeBasedCalendar(
      capturedStateRef.current.calendar,
      capturedStateRef.current.currentUser,
      capturedStateRef.current.invitees,
      capturedStateRef.current.inviteeCalendars,
      capturedStateRef.current.pendingReschedulingProposals
    );
  };

  // Helper function to render time-based calendar section
  const renderTimeBasedCalendar = (
    calendar: any,
    currentUser: User,
    invitees?: User[],
    inviteeCalendars?: Record<string, Calendar>,
    pendingReschedulingProposals?: any[]
  ) => {
      
      if (!calendar.events || calendar.events.length === 0) {
        return (
          <div className="text-gray-500 italic text-sm text-center py-8">
            No events scheduled for this date
          </div>
        );
      }


      // Get all events from all calendars
      const allEvents = [
        calendar.events,
        ...Object.values(inviteeCalendars || {}).map((cal) => cal.events || []),
      ].flat();

      // Find time range for the day based on user's preferred working hours
      const startHour = currentUser.preffered_working_hours?.[0] || 9; // Default to 9 AM if not specified
      const endHour = currentUser.preffered_working_hours?.[1] || 17; // Default to 5 PM if not specified
      const hourRange = endHour - startHour;

      // Create time slots
      const timeSlots = Array.from(
        { length: hourRange },
        (_, i) => startHour + i
      );

      // Helper function to get hour from time string
      const getHourFromTime = (timeString: string) => {
        return new Date(timeString).getHours();
      };

      // Helper function to get minutes from time string
      const getMinutesFromTime = (timeString: string) => {
        return new Date(timeString).getMinutes();
      };

      // Helper function to calculate position and height for an event
      const getEventPosition = (event: any) => {
        const eventStartHour = getHourFromTime(event.start_time);
        const startMinutes = getMinutesFromTime(event.start_time);
        const eventEndHour = getHourFromTime(event.end_time);
        const endMinutes = getMinutesFromTime(event.end_time);

        const startPosition =
          ((eventStartHour - startHour) * 60 + startMinutes) / 60;
        const duration =
          ((eventEndHour - eventStartHour) * 60 + (endMinutes - startMinutes)) /
          60;

        return { top: startPosition, height: duration };
      };

      // Helper function to check if an event has a pending rescheduling proposal
      const getPendingProposal = (event: any) => {
        if (!pendingReschedulingProposals) return null;
        return pendingReschedulingProposals.find(
          (proposal) => proposal.original_event.id === event.id
        );
      };

      return (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden" data-calendar-container>
          {/* Header with user avatars */}
          <div className="bg-gray-50 p-2">
            <div className="flex items-center ml-12">
              {/* Current user */}
              <div className="flex-1 flex flex-col items-center space-y-1">
                <img
                  src={currentUser.avatar_url}
                  alt={`${currentUser.given_name}'s avatar`}
                  className="w-8 h-8 rounded-full object-cover border-2 border-blue-500"
                  onError={(e) => {
                    e.currentTarget.src =
                      "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxjaXJjbGUgY3g9IjY0IiBjeT0iNjQiIHI9IjY0IiBmaWxsPSIjRDNEN0QwIi8+CjxwYXRoIGQ9Ik02NCA2NEM2Ny4zMTM3IDY0IDcwIDYxLjMxMzcgNzAgNThDNzAgNTQuNjg2MyA2Ny4zMTM3IDUyIDY0IDUyQzYwLjY4NjMgNTIgNTggNTQuNjg2MyA1OCA1OEM1OCA2MS4zMTM3IDYwLjY4NjMgNjQgNjQgNjRaIiBmaWxsPSIjOUNBM0FGIi8+CjxwYXRoIGQ9Ik02NCA2NkM1Ni4yNjg3IDY2IDUwIDcyLjI2ODcgNTAgODBINzhDNzggNzIuMjY4NyA3MS43MzEzIDY2IDY0IDY2WiIgZmlsbD0iIjlDQTNBRiIvPgo8L3N2Zz4K";
                  }}
                />
                <span className="text-xs font-medium text-gray-700">
                  {currentUser.given_name}
                </span>
              </div>

              {/* Invitees */}
              {invitees?.map((invitee) => (
                <div
                  key={invitee.id}
                  className="flex-1 flex flex-col items-center space-y-1"
                >
                  <img
                    src={invitee.avatar_url}
                    alt={`${invitee.given_name}'s avatar`}
                    className="w-8 h-8 rounded-full object-cover border-2 border-gray-300"
                    onError={(e) => {
                      e.currentTarget.src =
                        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAwL3N2ZyI+CjxjaXJjbGUgY3g9IjY0IiBjeT0iNjQiIHI9IjY0IiBmaWxsPSIjRDNEN0QwIi8+CjxwYXRoIGQ9Ik02NCA2NEM2Ny4zMTM3IDY0IDcwIDYxLjMxMzcgNzAgNThDNzAgNTQuNjg2MyA2Ny4zMTM3IDUyIDY0IDUyQzYwLjY4NjMgNTIgNTggNTQuNjg2MyA1OCA1OEM1OCA2MS4zMTM3IDYwLjY4NjMgNjQgNjQgNjRaIiBmaWxsPSIjOUNBM0FGIi8+CjxwYXRoIGQ9Ik02NCA2NkM1Ni4yNjg3IDY2IDUwIDcyLjI2ODcgNTAgODBINzhDNzggNzIuMjY4NyA3MS43MzEzIDY2IDY0IDY2WiIgZmlsbD0iIzlDQTNBRiIvPgo8L3N2Zz4K";
                    }}
                  />
                  <span className="text-xs font-medium text-gray-700">
                    {invitee.given_name}
                  </span>
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="relative mt-2" style={{ height: `${hourRange * 40}px` }}>
              {/* Time labels */}
              <div className="absolute left-0 top-0 w-12 h-full border-r bg-gray-50">
                {timeSlots.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-1 text-xs text-gray-500 font-mono"
                    style={{ top: `${(hour - startHour) * 40}px` }}
                  >
                    {hour === 12
                      ? "12 PM"
                      : hour > 12
                      ? `${hour - 12} PM`
                      : `${hour} AM`}
                  </div>
                ))}
              </div>

              {/* Hour grid lines */}
              {timeSlots.map((hour) => (
                <div
                  key={hour}
                  className="absolute left-12 right-0 border-t border-gray-200"
                  style={{ top: `${(hour - startHour) * 40}px` }}
                />
              ))}

              {/* User columns */}
              <div className="ml-12 h-full flex">
                {/* Current user column */}
                <div className="flex-1 relative border-r border-gray-200">
                  {calendar.events.map((event: any) => {
                    const { top, height } = getEventPosition(event);
                    const pendingProposal = getPendingProposal(event);

                    // Check if this event has a pending rescheduling proposal
                    if (pendingProposal) {
                      const newStartTime = new Date(
                        pendingProposal.new_start_time
                      );
                      const newEndTime = new Date(pendingProposal.new_end_time);
                      const newStartHour = newStartTime.getHours();
                      const newStartMinutes = newStartTime.getMinutes();
                      const newEndHour = newEndTime.getHours();
                      const newEndMinutes = newEndTime.getMinutes();

                      const newStartPosition =
                        ((newStartHour - startHour) * 60 + newStartMinutes) /
                        60;
                      const newDuration =
                        ((newEndHour - newStartHour) * 60 +
                          (newEndMinutes - newStartMinutes)) /
                        60;


                      return (
                        <div key={event.id} className="relative">
                          {/* Proposed new time slot (green) */}
                          <div
                            className="absolute left-1 right-1 bg-green-100 border border-green-400 rounded p-1 text-xs overflow-hidden z-10 shadow-md"
                            style={{
                              top: `${newStartPosition * 40}px`,
                              height: `${newDuration * 40}px`,
                              minHeight: "16px",
                            }}
                          >
                            <div className="font-medium text-green-900 truncate text-xs">
                              {event.title}
                            </div>
                            <div className="text-green-700 text-xs">
                              {newStartTime.toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true,
                              })}{" "}
                              -
                              {newEndTime.toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true,
                              })}
                            </div>
                          </div>

                          {/* Original time slot (faded red) */}
                          <div
                            className="absolute left-1 right-1 bg-red-100 border border-red-300 rounded p-1 text-xs overflow-hidden opacity-60"
                            style={{
                              top: `${top * 40}px`,
                              height: `${height * 40}px`,
                              minHeight: "16px",
                            }}
                          >
                            <div className="font-medium text-red-900 truncate text-xs">
                              {event.title}
                            </div>
                            <div className="text-red-700 text-xs">
                              {new Date(event.start_time).toLocaleTimeString(
                                [],
                                {
                                  hour: "numeric",
                                  minute: "2-digit",
                                  hour12: true,
                                }
                              )}{" "}
                              -
                              {new Date(event.end_time).toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true,
                              })}
                            </div>
                          </div>

                          {/* Arrow connecting original to proposed */}
                          <svg
                            className="absolute z-20"
                            style={{
                              left: "50%",
                              top: `${(top + height / 2) * 40}px`,
                              width: "24px",
                              height: `${Math.abs(newStartPosition - (top + height / 2)) * 40}px`,
                              transform: "translateX(-50%)",
                            }}
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d={newStartPosition > (top + height / 2) 
                                ? "M12 0 L12 24 M12 24 L8 20 M12 24 L16 20"
                                : "M12 24 L12 0 M12 0 L8 4 M12 0 L16 4"
                              }
                              stroke="black"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      );
                    }

                    // Regular event rendering
                    return (
                      <div
                        key={event.id}
                        className="absolute left-1 right-1 bg-gray-100 border border-gray-300 rounded p-1 text-xs overflow-hidden"
                        style={{
                          top: `${top * 40}px`,
                          height: `${height * 40}px`,
                          minHeight: "16px",
                        }}
                      >
                        <div className="font-medium text-gray-900 truncate text-xs">
                          {event.title}
                        </div>
                        <div className="text-gray-700 text-xs">
                          {new Date(event.start_time).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}{" "}
                          -
                          {new Date(event.end_time).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Invitee columns */}
                {invitees?.map((invitee) => {
                  const inviteeCalendar = inviteeCalendars?.[invitee.id];
                  return (
                    <div
                      key={invitee.id}
                      className="flex-1 relative border-r border-gray-200 last:border-r-0"
                    >
                      {inviteeCalendar?.events?.map((event: any) => {
                        const { top, height } = getEventPosition(event);
                        return (
                          <div
                            key={event.id}
                            className="absolute left-1 right-1 bg-gray-100 border border-gray-300 rounded p-1 text-xs overflow-hidden"
                            style={{
                              top: `${top * 40}px`,
                              height: `${height * 40}px`,
                              minHeight: "16px",
                            }}
                          >
                            <div className="font-medium text-gray-900 truncate text-xs">
                              {event.title}
                            </div>
                            <div className="text-gray-700 text-xs">
                              {new Date(event.start_time).toLocaleTimeString(
                                [],
                                {
                                  hour: "numeric",
                                  minute: "2-digit",
                                  hour12: true,
                                }
                              )}{" "}
                              -
                              {new Date(event.end_time).toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true,
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Legend - moved below calendar display */}
            {pendingReschedulingProposals &&
              pendingReschedulingProposals.length > 0 && (
                <div className="bg-gray-50 border-t p-2">
                  <div className="flex items-center justify-center space-x-4 text-xs">
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-gray-100 border border-gray-300 rounded"></div>
                      <span className="text-gray-600 text-xs">Unchanged Events</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-green-100 border-2 border-green-400 rounded"></div>
                      <span className="text-gray-600 text-xs">New Event Times</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-red-100 border border-red-300 rounded opacity-60"></div>
                      <span className="text-gray-600 text-xs">Old Event Time</span>
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>
      );
    };

  // Render state-specific content using accumulated state
  const renderStateContent = (state: any) => {
    // This function is now deprecated in favor of renderStateUpdate and renderResponse
    // But we'll keep it for backward compatibility
    
    // This function is now deprecated - the new stream format uses incremental updates
    // Return a message indicating this is legacy code
    return (
      <div className="p-3 bg-yellow-50 rounded-lg text-sm">
        <strong>Legacy State Display:</strong> This state type is no longer used in the new stream format.
        <pre className="text-xs mt-2 overflow-x-auto">
          {JSON.stringify(state, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Fixed header section */}
      <div className="sticky top-0 z-20 bg-gray-50 pt-4 pb-3">
        <div className="mx-auto text-center">
          <h1 className="text-3xl font-mono font-bold leading-tight text-gray-800">
            calendar-condenser
          </h1>

          {!isStarted ? (
            <button
              onClick={handleStart}
              className="mt-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 text-sm"
            >
              start
            </button>
          ) : null}


        </div>
      </div>

      {isStarted && (
        <div className="relative">
          {/* Centered Timeline column */}
          <div className="mx-auto w-[600px]">
            <div 
              className="overflow-y-auto pr-4 h-[calc(100vh-200px)]" 
              ref={timelineContainerRef}
              style={{ maxHeight: 'calc(100vh - 200px)' }}
            >
              {/* Debug information */}
              <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                <h3 className="font-semibold mb-1 text-xs">Debug Info:</h3>
                <p className="text-xs">
                  <strong>Timeline Items:</strong> {timeline.length}
                </p>
                <p className="text-xs">
                  <strong>Seen State IDs:</strong>{" "}
                  {Array.from(seenStateIdsRef.current).length}
                </p>
                <p className="text-xs">
                  <strong>Accumulated State:</strong>{" "}
                  {Object.keys(accumulatedState).length > 0 ? Object.keys(accumulatedState).join(", ") : "None"}
                </p>
                <p className="text-xs">
                  <strong>Waiting for Next State:</strong>{" "}
                  {waitingForNextState ? "Yes" : "No"}
                </p>
                <p className="text-xs">
                  <strong>Current Interrupt:</strong>{" "}
                  {currentInterrupt ? `Yes (${currentInterrupt.value})` : "No"}
                </p>
                <p className="text-xs">
                  <strong>Selected Option:</strong>{" "}
                  {Object.values(selectedInterruptOptions).join(", ") || "None"}
                </p>
                <p className="text-xs">
                  <strong>Is Resuming:</strong>{" "}
                  {isResuming ? "Yes" : "No"}
                </p>
              </div>

              {/* Render timeline items in chronological order */}
              {timeline.map((item, index) => {
                // Group consecutive subgraph_status items together
                if (item.type === 'subgraph_status') {
                  // Check if this is the first subgraph_status in a group
                  const prevItem = index > 0 ? timeline[index - 1] : null;
                  const nextItem = index < timeline.length - 1 ? timeline[index + 1] : null;
                  
                  // If previous item is not subgraph_status, this is the start of a group
                  if (!prevItem || prevItem.type !== 'subgraph_status') {
                    // Find all consecutive subgraph_status items
                    const subgraphGroup = [];
                    for (let i = index; i < timeline.length; i++) {
                      if (timeline[i].type === 'subgraph_status') {
                        subgraphGroup.push(timeline[i]);
                      } else {
                        break;
                      }
                    }
                    
                    // Render the group as a single container
                    return (
                      <div key={`subgraph-group-${index}`} className="w-full mb-3">
                        <div className="flex flex-wrap gap-3 justify-center">
                          {subgraphGroup.map((subgraphItem) => {
                            const { uuid } = subgraphItem.content;
                            const status = subgraphMessages[uuid];
                            const conversation = conversations[status?.toUser?.id] || [];
                            
                            if (status) {
                              return (
                                <MessageStatusComponent 
                                  key={subgraphItem.id}
                                  status={status} 
                                  conversation={conversation}
                                />
                              );
                            }
                            return null;
                          })}
                        </div>
                      </div>
                    );
                  }
                  
                  // Skip this item since it's part of a group that was already rendered
                  return null;
                }
                
                // Render non-subgraph items normally
                return renderTimelineItem(item);
              })}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
