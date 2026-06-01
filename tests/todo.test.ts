import { describe, expect, it } from "vitest";

import {
  createTodoState,
  createTodoWriteTool,
  extractTodosFromMessages,
  parseTodoList,
  type AgentMessage
} from "../src/index.js";

describe("todo", () => {
  it("parses valid todo lists", () => {
    expect(
      parseTodoList([
        {
          content: "Run tests",
          activeForm: "Running tests",
          status: "in_progress"
        }
      ])
    ).toEqual([
      {
        content: "Run tests",
        activeForm: "Running tests",
        status: "in_progress"
      }
    ]);
  });

  it("rejects invalid todo lists", () => {
    expect(parseTodoList("bad")).toBeUndefined();
    expect(parseTodoList([{ content: "", activeForm: "Running", status: "pending" }]))
      .toBeUndefined();
    expect(parseTodoList([{ content: "Run", activeForm: "", status: "pending" }]))
      .toBeUndefined();
    expect(parseTodoList([{ content: "Run", activeForm: "Running", status: "blocked" }]))
      .toBeUndefined();
  });

  it("updates state and clears it when all tasks are completed", async () => {
    const state = createTodoState();
    const tool = createTodoWriteTool(state);

    await expect(
      Promise.resolve(tool.execute(
        {
          todos: [
            {
              content: "Run tests",
              activeForm: "Running tests",
              status: "in_progress"
            }
          ]
        },
        {}
      ))
    ).resolves.toMatchObject({
      ok: true,
      content: "Todos updated. Continue using the todo list to track progress."
    });
    expect(state.getTodos()).toEqual([
      {
        content: "Run tests",
        activeForm: "Running tests",
        status: "in_progress"
      }
    ]);

    await Promise.resolve(tool.execute(
      {
        todos: [
          {
            content: "Run tests",
            activeForm: "Running tests",
            status: "completed"
          }
        ]
      },
      {}
    ));

    expect(state.getTodos()).toEqual([]);
  });

  it("extracts the latest TodoWrite call from messages", () => {
    const messages: readonly AgentMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            name: "TodoWrite",
            input: {
              todos: [
                {
                  content: "Old task",
                  activeForm: "Doing old task",
                  status: "pending"
                }
              ]
            }
          }
        ]
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_2",
            name: "TodoWrite",
            input: {
              todos: [
                {
                  content: "New task",
                  activeForm: "Doing new task",
                  status: "in_progress"
                }
              ]
            }
          }
        ]
      }
    ];

    expect(extractTodosFromMessages(messages)).toEqual([
      {
        content: "New task",
        activeForm: "Doing new task",
        status: "in_progress"
      }
    ]);
  });
});
