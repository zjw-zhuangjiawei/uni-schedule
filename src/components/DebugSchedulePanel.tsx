import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled from "@emotion/styled";
import {
  createSchedule,
  deleteSchedule,
  querySchedules,
  devSeedSample,
  type ScheduleDto,
} from "../api/schedule";
import { Button, Input, LoadingSpinner, ErrorMessage } from "./ui";
import { generateScheduleColor, toISOLocal } from "../utils";
import type { CreateSchedulePayload, PanelProps } from "../types";

interface DebugSchedulePanelProps extends PanelProps {
  onDataChange?: () => void;
}

export const DebugSchedulePanel: React.FC<DebugSchedulePanelProps> = ({
  open,
  onClose,
  onDataChange,
}) => {
  const [schedules, setSchedules] = useState<ScheduleDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    start: toISOLocal(new Date()),
    end: toISOLocal(new Date(Date.now() + 60 * 60 * 1000)),
    level: 0,
    exclusive: false,
  });

  const [selectedParents, setSelectedParents] = useState<Set<string>>(
    new Set(),
  );

  const toggleParent = useCallback((id: string) => {
    setSelectedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    console.log("DebugSchedulePanel.refresh() start");
    try {
      const data = await querySchedules({});
      console.log("DebugSchedulePanel.refresh() success, items=", data.length);
      setSchedules(data);
      onDataChange?.();
    } catch (e) {
      console.error("DebugSchedulePanel.refresh() error", e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(errorMessage);
    } finally {
      setLoading(false);
      console.log("DebugSchedulePanel.refresh() end");
    }
  }, [onDataChange]);

  useEffect(() => {
    if (open) {
      console.log("DebugSchedulePanel useEffect open=true -> refresh() called");
      refresh();
    }
  }, [open, refresh]);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload: CreateSchedulePayload = {
      name: formData.name.trim() || "Untitled Schedule",
      start: new Date(formData.start).toISOString(),
      end: new Date(formData.end).toISOString(),
      level: formData.level,
      exclusive: formData.exclusive,
      parents: Array.from(selectedParents),
    };

    try {
      await createSchedule(payload);
      // Reset form
      setFormData({
        name: "",
        start: toISOLocal(new Date()),
        end: toISOLocal(new Date(Date.now() + 60 * 60 * 1000)),
        level: 0,
        exclusive: false,
      });
      setSelectedParents(new Set());
      await refresh();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;

    try {
      await deleteSchedule(id);
      await refresh();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(errorMessage);
    }
  };

  const handleSeed = async () => {
    try {
      devSeedSample(5);
      await refresh();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(errorMessage);
    }
  };

  const parentCandidates = useMemo(
    () => schedules.filter((s) => s.level < formData.level),
    [schedules, formData.level],
  );

  if (!open) return null;

  return (
    <Overlay>
      <Panel>
        <Header>
          <Title>Schedule Debug Panel</Title>
          <CloseButton onClick={onClose}>×</CloseButton>
        </Header>

        <Section>
          <SectionTitle>Create New Schedule</SectionTitle>
          <Form onSubmit={handleFormSubmit}>
            <Input
              label="Name"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="Enter schedule name"
            />

            <Input
              label="Start Time"
              type="datetime-local"
              value={formData.start}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, start: e.target.value }))
              }
              required
            />

            <Input
              label="End Time"
              type="datetime-local"
              value={formData.end}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, end: e.target.value }))
              }
              required
            />

            <Input
              label="Level"
              type="number"
              value={formData.level}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  level: Number(e.target.value),
                }))
              }
            />

            <Input
              label="Exclusive"
              type="checkbox"
              value={formData.exclusive}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  exclusive: e.target.checked,
                }))
              }
            />

            {parentCandidates.length > 0 && (
              <ParentSelection>
                <ParentTitle>
                  Parent Schedules (must contain & be lower level)
                </ParentTitle>
                <ParentList>
                  {parentCandidates.map((parent) => (
                    <ParentItem key={parent.id}>
                      <Input
                        type="checkbox"
                        value={selectedParents.has(parent.id)}
                        onChange={() => toggleParent(parent.id)}
                      />
                      <ParentLabel title={`${parent.start} – ${parent.end}`}>
                        {parent.name} (Level {parent.level})
                      </ParentLabel>
                    </ParentItem>
                  ))}
                </ParentList>
              </ParentSelection>
            )}

            <ButtonGroup>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? "Creating..." : "Create Schedule"}
              </Button>
              <Button type="button" onClick={refresh} disabled={loading}>
                Refresh
              </Button>
              <Button type="button" onClick={handleSeed} variant="secondary">
                Seed Sample Data
              </Button>
            </ButtonGroup>
          </Form>

          {error && <ErrorMessage message={error} />}
        </Section>

        <Section>
          <ScheduleListHeader>
            <SectionTitle>Existing Schedules ({schedules.length})</SectionTitle>
            {loading && <LoadingSpinner text="" />}
          </ScheduleListHeader>

          <ScheduleList>
            {schedules.map((schedule) => (
              <ScheduleItem key={schedule.id}>
                <ColorSwatch
                  style={{
                    backgroundColor: generateScheduleColor(
                      schedule.id,
                      schedule.level,
                    ),
                  }}
                />
                <ScheduleInfo>
                  <ScheduleName>
                    {schedule.name}{" "}
                    <ScheduleMeta>
                      Level {schedule.level}
                      {schedule.exclusive && " • Exclusive"}
                    </ScheduleMeta>
                  </ScheduleName>
                  <ScheduleTime>
                    {new Date(schedule.start).toLocaleString()} →{" "}
                    {new Date(schedule.end).toLocaleString()}
                  </ScheduleTime>
                </ScheduleInfo>
                <Button
                  variant="danger"
                  size="small"
                  onClick={() => handleDelete(schedule.id)}
                >
                  Delete
                </Button>
              </ScheduleItem>
            ))}
            {schedules.length === 0 && !loading && (
              <EmptyMessage>No schedules created yet</EmptyMessage>
            )}
          </ScheduleList>
        </Section>
      </Panel>
    </Overlay>
  );
};

// Styled Components
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  z-index: 9999;
`;

const Panel = styled.div`
  width: 420px;
  max-height: 100%;
  overflow: auto;
  background: #1e1e23;
  color: #f5f5f5;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  padding: 16px;
  box-shadow: 0 4px 18px -2px rgba(0, 0, 0, 0.5);
  border-top-left-radius: 8px;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
`;

const CloseButton = styled.button`
  background: transparent;
  color: inherit;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px;

  &:hover {
    opacity: 0.7;
  }
`;

const Section = styled.div`
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ParentSelection = styled.fieldset`
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px;
`;

const ParentTitle = styled.legend`
  font-size: 12px;
  padding: 0 4px;
`;

const ParentList = styled.div`
  max-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ParentItem = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
`;

const ParentLabel = styled.span`
  flex: 1;
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const ScheduleListHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ScheduleList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
`;

const ScheduleItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  background: #282830;
  padding: 8px;
  border-radius: 4px;
`;

const ColorSwatch = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 3px;
  flex-shrink: 0;
`;

const ScheduleInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ScheduleName = styled.div`
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
`;

const ScheduleMeta = styled.span`
  opacity: 0.7;
  font-weight: normal;
`;

const ScheduleTime = styled.div`
  font-size: 11px;
  opacity: 0.7;
  margin-top: 2px;
`;

const EmptyMessage = styled.div`
  font-size: 12px;
  opacity: 0.7;
  text-align: center;
  padding: 16px;
`;

export default DebugSchedulePanel;
