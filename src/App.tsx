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

interface StateWithCalendar {
  type: string;
  date: string;
  user: User;
  calendar: Calendar;
}

interface StateWithInvitees {
  type: string;
  date: string;
  user: User;
  calendar: Calendar;
  invitees: User[];
  invitee_calendars: Record<string, Calendar>;
}

interface StateWithPendingReschedulingProposals {
  type: string;
  date: string;
  user: User;
  calendar: Calendar;
  invitees: User[];
  invitee_calendars: Record<string, Calendar>;
  pending_rescheduling_proposals: any[];
}

interface StateWithCompletedReschedulingProposals {
  type: string;
  date: string;
  user: User;
  calendar: Calendar;
  invitees: User[];
  invitee_calendars: Record<string, Calendar>;
  pending_rescheduling_proposals: any[];
  completed_rescheduling_proposals: any[];
}

// Timeline item interface
interface TimelineItem {
  id: string;
  timestamp: number;
  type: "ai_message" | "state_change";
  content: any;
  stateType?: string; // For state changes, track the type
  messageId?: string; // For AI messages, track the message ID to group chunks
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
  const [currentState, setCurrentState] = useState<Record<string, any> | null>(
    null
  );
  const [inviteeUsers, setInviteeUsers] = useState<Record<string, User>>({});
  const [loadingInvitees, setLoadingInvitees] = useState<
    Record<string, boolean>
  >({});
  const [seenStateTypes, setSeenStateTypes] = useState<Set<string>>(new Set());
  const seenStateIdsRef = useRef<Set<string>>(new Set());
  const [threadId] = useState<string>(() => generateUUID());

  // Generate thread_id once at startup
  useEffect(() => {
    console.log(`Generated thread_id: ${threadId}`);
  }, [threadId]);

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

  const handleStart = async () => {
    setIsStarted(true);
    setTimeline([]);
    setSeenStateTypes(new Set());
    seenStateIdsRef.current = new Set();

    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/graphs/default/threads/${threadId}/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
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
            } else if (data.type && data.type !== "AIMessageChunk") {
              // Generate a unique ID for this state based on its content
              const stateId = generateStateId(data);

              console.log(
                `Processing state: ${data.type}, Generated ID: ${stateId}`
              );
              console.log(
                `Already seen: ${seenStateIdsRef.current.has(stateId)}`
              );

              // Check if this exact state has been seen before
              if (!seenStateIdsRef.current.has(stateId)) {
                // First time seeing this state - add to timeline and mark as seen
                console.log(`Adding new state to timeline: ${data.type}`);
                seenStateIdsRef.current.add(stateId);

                setTimeline((prev) => [
                  ...prev,
                  {
                    id: `state_${data.type}_${Date.now()}`,
                    timestamp: Date.now(),
                    type: "state_change" as const,
                    content: data,
                    stateType: data.type,
                  },
                ]);
              } else {
                console.log(`Skipping duplicate state: ${data.type}`);
              }

              // Always update current state for rendering
              setCurrentState(data);
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

  // Generate a unique ID for a state based on its content
  const generateStateId = (state: any): string => {
    if (state.type === "InitialState") {
      return `initial_${state.user?.id}_${state.date}`;
    }

    if (state.type === "StateWithCalendar") {
      const events = state.calendar?.events || [];
      const eventIds = events
        .map((e: any) => e.id)
        .sort()
        .join(",");
      return `calendar_${state.user?.id}_${state.date}_${eventIds}`;
    }

    if (state.type === "StateWithInvitees") {
      const events = state.calendar?.events || [];
      const eventIds = events
        .map((e: any) => e.id)
        .sort()
        .join(",");
      const inviteeIds = (state.invitees || [])
        .map((i: any) => i.id)
        .sort()
        .join(",");
      return `invitees_${state.user?.id}_${state.date}_${eventIds}_${inviteeIds}`;
    }

    if (state.type === "StateWithPendingReschedulingProposals") {
      const events = state.calendar?.events || [];
      const eventIds = events
        .map((e: any) => e.id)
        .sort()
        .join(",");
      const proposalCount = (state.pending_rescheduling_proposals || []).length;
      return `pending_${state.user?.id}_${state.date}_${eventIds}_${proposalCount}`;
    }

    if (state.type === "StateWithCompletedReschedulingProposals") {
      const events = state.calendar?.events || [];
      const eventIds = events
        .map((e: any) => e.id)
        .sort()
        .join(",");
      const proposalCount = (state.completed_rescheduling_proposals || [])
        .length;
      return `completed_${state.user?.id}_${state.date}_${eventIds}_${proposalCount}`;
    }

    // Fallback for unknown state types
    return `${state.type}_${JSON.stringify(state).slice(0, 100)}`;
  };

  // Render timeline items
  const renderTimelineItem = (item: TimelineItem) => {
    if (item.type === "ai_message") {
      // Handle escaped newlines from backend (convert \n to actual newlines)
      const processedContent = item.content.replace(/\\n/g, "\n");

      return (
        <div
          key={item.id}
          className="p-4 bg-white border rounded-lg text-left mb-6"
        >
          <h2 className="font-semibold mb-2">LLM Response:</h2>
          <ReactMarkdown>{processedContent}</ReactMarkdown>
        </div>
      );
    }

    if (item.type === "state_change") {
      return (
        <div key={item.id} className="w-full mb-6">
          {renderStateContent(item.content)}
        </div>
      );
    }

    return null;
  };

  // Render state-specific content
  const renderStateContent = (state: any) => {
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
          <div className="bg-gray-50 p-4">
            <div className="flex items-center ml-16">
              {/* Current user */}
              <div className="flex-1 flex flex-col items-center space-y-2">
                <img
                  src={currentUser.avatar_url}
                  alt={`${currentUser.given_name}'s avatar`}
                  className="w-12 h-12 rounded-full object-cover border-2 border-blue-500"
                  onError={(e) => {
                    e.currentTarget.src =
                      "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxjaXJjbGUgY3g9IjY0IiBjeT0iNjQiIHI9IjY0IiBmaWxsPSIjRDNEN0QwIi8+CjxwYXRoIGQ9Ik02NCA2NEM2Ny4zMTM3IDY0IDcwIDYxLjMxMzcgNzAgNThDNzAgNTQuNjg2MyA2Ny4zMTM3IDUyIDY0IDUyQzYwLjY4NjMgNTIgNTggNTQuNjg2MyA1OCA1OEM1OCA2MS4zMTM3IDYwLjY4NjMgNjQgNjQgNjRaIiBmaWxsPSIjOUNBM0FGIi8+CjxwYXRoIGQ9Ik02NCA2NkM1Ni4yNjg3IDY2IDUwIDcyLjI2ODcgNTAgODBINzhDNzggNzIuMjY4NyA3MS43MzEzIDY2IDY0IDY2WiIgZmlsbD0iIjlDQTNBRiIvPgo8L3N2Zz4K";
                  }}
                />
                <span className="text-sm font-medium text-gray-700">
                  {currentUser.given_name}
                </span>
              </div>

              {/* Invitees */}
              {invitees?.map((invitee) => (
                <div
                  key={invitee.id}
                  className="flex-1 flex flex-col items-center space-y-2"
                >
                  <img
                    src={invitee.avatar_url}
                    alt={`${invitee.given_name}'s avatar`}
                    className="w-12 h-12 rounded-full object-cover border-2 border-gray-300"
                    onError={(e) => {
                      e.currentTarget.src =
                        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAwL3N2ZyI+CjxjaXJjbGUgY3g9IjY0IiBjeT0iNjQiIHI9IjY0IiBmaWxsPSIjRDNEN0QwIi8+CjxwYXRoIGQ9Ik02NCA2NEM2Ny4zMTM3IDY0IDcwIDYxLjMxMzcgNzAgNThDNzAgNTQuNjg2MyA2Ny4zMTM3IDUyIDY0IDUyQzYwLjY4NjMgNTIgNTggNTQuNjg2MyA1OCA1OEM1OCA2MS4zMTM3IDYwLjY4NjMgNjQgNjQgNjRaIiBmaWxsPSIjOUNBM0FGIi8+CjxwYXRoIGQ9Ik02NCA2NkM1Ni4yNjg3IDY2IDUwIDcyLjI2ODcgNTAgODBINzhDNzggNzIuMjY4NyA3MS43MzEzIDY2IDY0IDY2WiIgZmlsbD0iIzlDQTNBRiIvPgo8L3N2Zz4K";
                    }}
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {invitee.given_name}
                  </span>
                </div>
              ))}
            </div>



            {/* Calendar grid */}
            <div className="relative mt-4" style={{ height: `${hourRange * 60}px` }}>
              {/* Time labels */}
              <div className="absolute left-0 top-0 w-16 h-full border-r bg-gray-50">
                {timeSlots.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-2 text-xs text-gray-500 font-mono"
                    style={{ top: `${(hour - startHour) * 60}px` }}
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
                  className="absolute left-16 right-0 border-t border-gray-200"
                  style={{ top: `${(hour - startHour) * 60}px` }}
                />
              ))}

              {/* User columns */}
              <div className="ml-16 h-full flex">
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
                            className="absolute left-1 right-1 bg-green-100 border-2 border-green-400 rounded p-2 text-xs overflow-hidden z-10 shadow-md"
                            style={{
                              top: `${newStartPosition * 60}px`,
                              height: `${newDuration * 60}px`,
                              minHeight: "20px",
                            }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="font-medium text-green-900 truncate flex-1">
                                {event.title}
                              </div>
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
                            className="absolute left-1 right-1 bg-red-100 border border-red-300 rounded p-2 text-xs overflow-hidden opacity-60"
                            style={{
                              top: `${top * 60}px`,
                              height: `${height * 60}px`,
                              minHeight: "20px",
                            }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="font-medium text-red-900 truncate flex-1">
                                {event.title}
                              </div>
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
                              top: `${(top + height) * 60}px`,
                              width: "24px",
                              height: `${(newStartPosition - (top + height)) * 60}px`,
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
                        className="absolute left-1 right-1 bg-gray-100 border border-gray-300 rounded p-2 text-xs overflow-hidden"
                        style={{
                          top: `${top * 60}px`,
                          height: `${height * 60}px`,
                          minHeight: "20px",
                        }}
                      >
                        <div className="font-medium text-gray-900 truncate">
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
                            className="absolute left-1 right-1 bg-gray-100 border border-gray-300 rounded p-2 text-xs overflow-hidden"
                            style={{
                              top: `${top * 60}px`,
                              height: `${height * 60}px`,
                              minHeight: "20px",
                            }}
                          >
                            <div className="font-medium text-gray-900 truncate">
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
                <div className="bg-gray-50 border-t p-3">
                  <div className="flex items-center justify-center space-x-6 text-xs">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-gray-100 border border-gray-300 rounded"></div>
                      <span className="text-gray-600">Unchanged Events</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-green-100 border-2 border-green-400 rounded"></div>
                      <span className="text-gray-600">New Event Times</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-100 border border-red-300 rounded opacity-60"></div>
                      <span className="text-gray-600">Old Event Time</span>
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>
      );
    };

    // Handle different state types
    if (state.type === "InitialState") {
      console.log("Handling InitialState");
      // Nothing to show for initial state
      return null;
    }

    if (state.type === "StateWithCalendar") {
      console.log("Handling StateWithCalendar");
      const calendarState = state as StateWithCalendar;
      return renderTimeBasedCalendar(
        calendarState.calendar,
        calendarState.user
      );
    }

    if (state.type === "StateWithInvitees") {
      console.log("Handling StateWithInvitees");
      const inviteeState = state as StateWithInvitees;
      return renderTimeBasedCalendar(
        inviteeState.calendar,
        inviteeState.user,
        inviteeState.invitees,
        inviteeState.invitee_calendars
      );
    }

    if (state.type === "StateWithPendingReschedulingProposals") {
      console.log("Handling StateWithPendingReschedulingProposals");
      const reschedulingState = state as StateWithPendingReschedulingProposals;
      return (
        <>
          {renderTimeBasedCalendar(
            reschedulingState.calendar,
            reschedulingState.user,
            reschedulingState.invitees,
            reschedulingState.invitee_calendars,
            reschedulingState.pending_rescheduling_proposals
          )}

          {/* Pending Rescheduling Proposals */}
          <div className="mt-8 space-y-3 text-sm text-gray-700">
            {reschedulingState.pending_rescheduling_proposals.map(
              (proposal, index) => (
                <div key={index} className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                  <p>
                    <strong>Event:</strong>{" "}
                    {proposal.original_event?.title || "Unknown Event"}
                  </p>
                  <p>
                    <strong>Time Change:</strong>{" "}
                    <span className="text-red-600 font-medium">
                      {new Date(proposal.original_event?.start_time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} - {new Date(proposal.original_event?.end_time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                    </span>
                    {" → "}
                    <span className="text-green-600 font-medium">
                      {new Date(proposal.new_start_time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} - {new Date(proposal.new_end_time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                    </span>
                  </p>
                  <p>
                    <strong>Reason:</strong> {proposal.explanation}
                  </p>
                  <div className="flex gap-3 mt-4 justify-center">
                    <button
                      onClick={() => handleAcceptRescheduling(proposal, index)}
                      className="px-4 py-2 bg-gray-100 text-green-700 text-sm rounded-md hover:bg-green-50 transition-all duration-200 font-medium"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRejectRescheduling(proposal, index)}
                      className="px-4 py-2 bg-gray-100 text-red-700 text-sm rounded-md hover:bg-red-50 transition-all duration-200 font-medium"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </>
      );
    }

    if (state.type === "StateWithCompletedReschedulingProposals") {
      console.log("Handling StateWithCompletedReschedulingProposals");
      const completedState = state as StateWithCompletedReschedulingProposals;
      return (
        <>
          {renderTimeBasedCalendar(
            completedState.calendar,
            completedState.user,
            completedState.invitees,
            completedState.invitee_calendars,
            completedState.pending_rescheduling_proposals
          )}

          {/* Completed Rescheduling Proposals */}
          <div className="bg-green-50 p-6 rounded-lg border border-green-200">
            <h4 className="font-medium text-green-900 mb-3">
              ✅ Completed Rescheduling Proposals (
              {completedState.completed_rescheduling_proposals.length})
            </h4>
            <div className="space-y-2 text-sm text-green-800">
              {completedState.completed_rescheduling_proposals.map(
                (proposal, index) => (
                  <div key={index} className="p-3 bg-green-100 rounded">
                    <p>
                      <strong>Event:</strong>{" "}
                      {proposal.original_event?.title || "Unknown Event"}
                    </p>
                    <p>
                      <strong>Time Change:</strong>{" "}
                      <span className="text-red-600 font-medium">
                        {new Date(proposal.original_event?.start_time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} - {new Date(proposal.original_event?.end_time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      </span>
                      {" → "}
                      <span className="text-green-600 font-medium">
                        {new Date(proposal.new_start_time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} - {new Date(proposal.new_end_time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      </span>
                    </p>
                    <p>
                      <strong>Status:</strong>{" "}
                      {proposal.type === "AcceptedRescheduledEvent"
                        ? "✅ Accepted"
                        : "❌ Rejected"}
                    </p>
                    <p>
                      <strong>Reason:</strong> {proposal.explanation}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        </>
      );
    }

    // Default state display
    console.log("No matching state type, showing default display");
    return (
      <div className="p-4 bg-gray-100 rounded-lg text-left">
        <h2 className="font-semibold mb-2">Current State:</h2>
        <pre className="text-xs overflow-y-auto whitespace-pre-wrap h-[500px]">
          {JSON.stringify(state, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Fixed header section */}
      <div className="sticky top-0 z-20 bg-gray-50 pt-8 pb-6">
        <div className="mx-auto text-center">
          <h1 className="text-5xl font-mono font-bold leading-tight text-gray-800">
            calendar-condenser
          </h1>

          {!isStarted ? (
            <button
              onClick={handleStart}
              className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
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
            <div className="overflow-y-auto pr-4">
              {/* Debug information */}
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs">
                <h3 className="font-semibold mb-2">Debug Info:</h3>
                <p>
                  <strong>Timeline Items:</strong> {timeline.length}
                </p>
                <p>
                  <strong>Seen State IDs:</strong>{" "}
                  {Array.from(seenStateIdsRef.current).length}
                </p>
                <p>
                  <strong>Current State Type:</strong>{" "}
                  {currentState?.type || "None"}
                </p>
              </div>

              {/* Render timeline items in chronological order */}
              {timeline.map(renderTimelineItem)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
