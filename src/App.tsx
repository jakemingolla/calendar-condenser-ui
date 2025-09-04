import "./index.css";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

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
  message_analysis: "positive" | "negative" | "unknown";
}

interface OutgoingMessage {
  content: string;
  sent_at: string;
  from_user: User;
  to_user: User;
}

interface IncomingMessage {
  content: string;
  sent_at: string;
  from_user: User;
  to_user: User;
}

// State key types for the new stream format
type StateKey = 
  | "$.introduction"
  | "$.confirm_start"
  | "$.load_calendar"
  | "$.summarize_calendar"
  | "$.load_invitees"
  | "$.before_rescheduling_proposals"
  | "$.get_rescheduling_proposals"
  | "$.confirm_rescheduling_proposals"
  | "$.invoke_send_rescheduling_proposal_to_invitee"
  | "$.final_summarization";

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

// Timeline item interface
interface TimelineItem {
  id: string;
  timestamp: number;
  type: "ai_message" | "state_update" | "interrupt" | "response";
  content: any;
  stateKey?: StateKey; // For state updates, track the state key
  messageId?: string; // For AI messages, track the message ID to group chunks
  responseType?: string; // For responses, track the response type
}

// Function to generate a random UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [accumulatedState, setAccumulatedState] = useState<AccumulatedState>({});
  const [inviteeUsers, setInviteeUsers] = useState<Record<string, User>>({});
  const [loadingInvitees, setLoadingInvitees] = useState<
    Record<string, boolean>
  >({});
  const [seenStateKeys, setSeenStateKeys] = useState<Set<StateKey>>(new Set());
  const [waitingForNextState, setWaitingForNextState] = useState(false);
  const [currentInterrupt, setCurrentInterrupt] = useState<Interrupt | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [selectedInterruptOptions, setSelectedInterruptOptions] = useState<Record<string, string>>({});
  const seenStateIdsRef = useRef<Set<string>>(new Set());
  const [threadId] = useState<string>(() => generateUUID());
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // Generate thread_id once at startup
  useEffect(() => {
    console.log(`Generated thread_id: ${threadId}`);
  }, [threadId]);

  // Auto-scroll to bottom when timeline updates
  useEffect(() => {
    if (timelineContainerRef.current && timeline.length > 0) {
      console.log('Auto-scrolling to bottom, timeline length:', timeline.length);
      console.log('Container scrollHeight:', timelineContainerRef.current.scrollHeight);
      console.log('Container clientHeight:', timelineContainerRef.current.clientHeight);
      
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
  }, [timeline]);

  // Function to fetch user information for invitees
  const fetchInviteeUser = async (userId: string) => {
    if (inviteeUsers[userId]) return; // Already fetched

    setLoadingInvitees((prev) => ({ ...prev, [userId]: true }));

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
    } finally {
      setLoadingInvitees((prev) => ({ ...prev, [userId]: false }));
    }
  };

  // Function to handle accepting a rescheduling proposal
  const handleAcceptRescheduling = async (proposal: any, index: number) => {
    console.log("Accepting rescheduling proposal:", proposal);
    // TODO: Implement API call to accept the proposal
    // For now, just log the action
    alert(`Accepted rescheduling for: ${proposal.original_event?.title}`);
  };

  // Function to handle rejecting a rescheduling proposal
  const handleRejectRescheduling = async (proposal: any, index: number) => {
    console.log("Rejecting rescheduling proposal:", proposal);
    // TODO: Implement API call to reject the proposal
    // For now, just log the action
    alert(`Rejected rescheduling for: ${proposal.original_event?.title}`);
  };

  // Helper function to update accumulated state based on state key
  const updateAccumulatedState = (stateKey: StateKey, data: any) => {
    setAccumulatedState(prev => {
      const newState = { ...prev };
      
      switch (stateKey) {
        case "$.load_calendar":
          if (data && data.calendar) {
            newState.calendar = data.calendar;
            // Extract user and date from calendar if available
            if (data.calendar.owner) {
              newState.user = { ...newState.user, id: data.calendar.owner } as User;
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
          console.log(`Unhandled state key: ${stateKey}`);
      }
      
      return newState;
    });
  };

  // Helper function to update accumulated state from response objects
  const updateAccumulatedStateFromResponse = (data: any) => {
    setAccumulatedState(prev => {
      const newState = { ...prev };
      
      switch (data.type) {
        case "LoadCalendarResponse":
          if (data.calendar) {
            newState.calendar = data.calendar;
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
        default:
          console.log(`Unhandled response type: ${data.type}`);
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
              console.log("Received interrupt:", data);
              setCurrentInterrupt(data);
              setWaitingForNextState(false);
              
              // Add interrupt to timeline
              setTimeline((prev) => [
                ...prev,
                {
                  id: `interrupt_${data.id}_${Date.now()}`,
                  timestamp: Date.now(),
                  type: "interrupt" as const,
                  content: data,
                },
              ]);
            } else {
              // Handle state updates and responses
              const stateKey = Object.keys(data).find(key => key.startsWith('$.')) as StateKey;
              
              if (stateKey) {
                // This is a state update
                console.log(`Processing resumed state update: ${stateKey}`);
                
                if (!seenStateKeys.has(stateKey)) {
                  setSeenStateKeys(prev => new Set([...prev, stateKey]));
                  setWaitingForNextState(false);

                  // Only add to timeline if there's actual content (not null)
                  if (data[stateKey] !== null) {
                    setTimeline((prev) => [
                      ...prev,
                      {
                        id: `state_${stateKey}_${Date.now()}`,
                        timestamp: Date.now(),
                        type: "state_update" as const,
                        content: data[stateKey],
                        stateKey: stateKey,
                      },
                    ]);
                  }

                  // Update accumulated state
                  updateAccumulatedState(stateKey, data[stateKey]);
                }
              } else if (data.type) {
                // This is a response object
                console.log(`Processing resumed response: ${data.type}`);
                
                setTimeline((prev) => [
                  ...prev,
                  {
                    id: `response_${data.type}_${Date.now()}`,
                    timestamp: Date.now(),
                    type: "response" as const,
                    content: data,
                    responseType: data.type,
                  },
                ]);

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
              console.log("Received interrupt:", data);
              setCurrentInterrupt(data);
              setWaitingForNextState(false);
              
              // Add interrupt to timeline
              setTimeline((prev) => [
                ...prev,
                {
                  id: `interrupt_${data.id}_${Date.now()}`,
                  timestamp: Date.now(),
                  type: "interrupt" as const,
                  content: data,
                },
              ]);
            } else {
              // Handle state updates and responses
              const stateKey = Object.keys(data).find(key => key.startsWith('$.')) as StateKey;
              
              if (stateKey) {
                // This is a state update
                console.log(`Processing state update: ${stateKey}`);
                
                if (!seenStateKeys.has(stateKey)) {
                  setSeenStateKeys(prev => new Set([...prev, stateKey]));
                  setWaitingForNextState(false);

                  // Only add to timeline if there's actual content (not null)
                  if (data[stateKey] !== null) {
                    setTimeline((prev) => [
                      ...prev,
                      {
                        id: `state_${stateKey}_${Date.now()}`,
                        timestamp: Date.now(),
                        type: "state_update" as const,
                        content: data[stateKey],
                        stateKey: stateKey,
                      },
                    ]);
                  }

                  // Update accumulated state
                  updateAccumulatedState(stateKey, data[stateKey]);
                }
              } else if (data.type) {
                // This is a response object
                console.log(`Processing response: ${data.type}`);
                
                setTimeline((prev) => [
                  ...prev,
                  {
                    id: `response_${data.type}_${Date.now()}`,
                    timestamp: Date.now(),
                    type: "response" as const,
                    content: data,
                    responseType: data.type,
                  },
                ]);

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
          <ReactMarkdown>{processedContent}</ReactMarkdown>
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
            <p className="text-yellow-700 text-sm mb-3">
              {interrupt.value}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleResume("CONFIRMED")}
                disabled={isResuming || isConfirmed || isRejected}
                className={`px-4 py-2 text-sm rounded-md transition-colors duration-200 font-medium ${
                  isConfirmed
                    ? "bg-green-700 text-white cursor-default"
                    : isRejected
                    ? "bg-gray-400 text-gray-600 cursor-not-allowed"
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
                    ? "bg-red-700 text-white cursor-default"
                    : isConfirmed
                    ? "bg-gray-400 text-gray-600 cursor-not-allowed"
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
          {renderStateUpdate(item.stateKey!, item.content)}
        </div>
      );
    }

    if (item.type === "response") {
      return (
        <div key={item.id} className="w-full mb-3">
          {renderResponse(item.responseType!, item.content)}
        </div>
      );
    }

    return null;
  };

  // Render state update based on state key
  const renderStateUpdate = (stateKey: StateKey, content: any) => {
    if (content === null) {
      // Don't show anything for null state updates - these are internal processing steps
      return null;
    }

    switch (stateKey) {
      case "$.load_calendar":
        return renderCalendarUpdate(content);
      case "$.load_invitees":
        return renderInviteesUpdate(content);
      case "$.get_rescheduling_proposals":
        return renderReschedulingProposalsUpdate(content);
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
  const renderResponse = (responseType: string, content: any) => {
    switch (responseType) {
      case "LoadCalendarResponse":
        return renderCalendarUpdate(content);
      case "LoadInviteesResponse":
        return renderInviteesUpdate(content);
      case "GetReschedulingProposalsResponse":
        return renderReschedulingProposalsUpdate(content);
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
      case "$.introduction": return "Introduction";
      case "$.confirm_start": return "Confirm Start";
      case "$.load_calendar": return "Load Calendar";
      case "$.summarize_calendar": return "Summarize Calendar";
      case "$.load_invitees": return "Load Invitees";
      case "$.before_rescheduling_proposals": return "Before Rescheduling Proposals";
      case "$.get_rescheduling_proposals": return "Get Rescheduling Proposals";
      case "$.confirm_rescheduling_proposals": return "Confirm Rescheduling Proposals";
      case "$.invoke_send_rescheduling_proposal_to_invitee": return "Send Rescheduling Proposal";
      case "$.final_summarization": return "Final Summarization";
      default: return stateKey;
    }
  };

  // Render calendar update
  const renderCalendarUpdate = (data: any) => {
    const calendar = data.calendar || data;
    if (!calendar || !calendar.events) {
      return (
        <div className="p-3 bg-gray-100 rounded-lg text-center text-sm text-gray-600">
          Loading calendar...
        </div>
      );
    }

    // For now, just show a simple calendar display
    return (
      <div className="p-3 bg-white rounded-lg border shadow-sm">
        <h4 className="font-medium text-gray-900 mb-2 text-sm">Calendar Loaded</h4>
        <div className="text-xs text-gray-600">
          {calendar.events?.length || 0} events found
        </div>
        {calendar.events?.map((event: any, index: number) => (
          <div key={index} className="mt-2 p-2 bg-gray-50 rounded text-xs">
            <div className="font-medium">{event.title}</div>
            <div className="text-gray-600">
              {new Date(event.start_time).toLocaleTimeString()} - {new Date(event.end_time).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render invitees update
  const renderInviteesUpdate = (data: any) => {
    const invitees = data.invitees || [];
    const inviteeCalendars = data.invitee_calendars || {};
    
    if (invitees.length === 0) {
      return (
        <div className="p-3 bg-gray-100 rounded-lg text-center text-sm text-gray-600">
          Loading invitees...
        </div>
      );
    }

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
  const renderReschedulingProposalsUpdate = (data: any) => {
    const proposals = data.pending_rescheduling_proposals || [];
    
    if (proposals.length === 0) {
      return (
        <div className="p-3 bg-gray-100 rounded-lg text-center text-sm text-gray-600">
          No rescheduling proposals found
        </div>
      );
    }

    return (
      <div className="p-3 bg-white rounded-lg border shadow-sm">
        <h4 className="font-medium text-gray-900 mb-2 text-sm">Rescheduling Proposals</h4>
        <div className="space-y-2">
          {proposals.map((proposal: PendingRescheduledEvent, index: number) => (
            <div key={index} className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
              <p><strong>Event:</strong> {proposal.original_event?.title}</p>
              <p><strong>New Time:</strong> {new Date(proposal.new_start_time).toLocaleTimeString()} - {new Date(proposal.new_end_time).toLocaleTimeString()}</p>
              <p><strong>Reason:</strong> {proposal.explanation}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render message response
  const renderMessageResponse = (type: string, message: any) => {
    return (
      <div className="p-3 bg-blue-50 rounded-lg text-sm">
        <strong>{type} Message:</strong> {message.content}
        <div className="text-xs text-gray-600 mt-1">
          From: {message.from_user?.given_name} → To: {message.to_user?.given_name}
        </div>
      </div>
    );
  };

  // Render state-specific content using accumulated state
  const renderStateContent = (state: any) => {
    // This function is now deprecated in favor of renderStateUpdate and renderResponse
    // But we'll keep it for backward compatibility
    console.log("renderStateContent called with state type:", state.type);
    console.log("State data:", state);
    
    // Helper function to render time-based calendar section
    const renderTimeBasedCalendar = (
      calendar: any,
      currentUser: User,
      invitees?: User[],
      inviteeCalendars?: Record<string, Calendar>,
      pendingReschedulingProposals?: any[]
    ) => {
      console.log("renderTimeBasedCalendar called with:");
      console.log("- calendar:", calendar);
      console.log("- currentUser:", currentUser);
      console.log("- invitees:", invitees);
      console.log("- inviteeCalendars:", inviteeCalendars);
      console.log("- pendingReschedulingProposals:", pendingReschedulingProposals);
      
      if (!calendar.events || calendar.events.length === 0) {
        return (
          <div className="text-gray-500 italic text-sm text-center py-8">
            No events scheduled for this date
          </div>
        );
      }

      console.log(
        "There are ",
        pendingReschedulingProposals?.length,
        "pending rescheduling proposals"
      );

      // Get all events from all calendars
      const allEvents = [
        calendar.events,
        ...Object.values(inviteeCalendars || {}).map((cal) => cal.events || []),
      ].flat();

      // Find time range for the day based on user's preferred working hours
      const startHour = currentUser.preffered_working_hours?.[0] || 6; // Default to 6 AM if not specified
      const endHour = currentUser.preffered_working_hours?.[1] || 22; // Default to 10 PM if not specified
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
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
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

                      console.log(
                        "event",
                        event.title,
                        "newStartPosition",
                        newStartPosition,
                        "newDuration",
                        newDuration
                      );

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
                              top: `${(top + height) * 40}px`,
                              width: "24px",
                              height: `${(newStartPosition - (top + height)) * 40}px`,
                              transform: "translateX(-50%)",
                            }}
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M12 0 L12 24 M12 24 L8 20 M12 24 L16 20"
                              stroke="black"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      );
                    } else {
                      console.log("no pending proposal for event", event.title);
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
              {timeline.map(renderTimelineItem)}

              {/* Show placeholder when waiting for next state or resuming */}
              {(waitingForNextState || isResuming) && (
                <div className="p-4 rounded-lg mb-3">
                  <div className="animate-pulse">
                    <div className="h-32 bg-gradient-to-br from-gray-200 via-gray-100 to-gray-300 rounded"></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
