import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import type { PortfolioProject } from "@/server/queries/portfolio-projects";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/server/actions/portfolio", () => ({ finishPortfolioUpload: vi.fn() }));
vi.mock("@/server/actions/portfolio-projects", () => ({
  createProjectAction: vi.fn(async () => ({ ok: false, code: "titleRequired" })),
  updateProjectAction: vi.fn(), deleteProjectAction: vi.fn(), removeProjectMediaAction: vi.fn(),
  reorderProjectAction: vi.fn(), reorderProjectsAction: vi.fn(), setProjectCoverAction: vi.fn(),
  setProjectVisibilityAction: vi.fn(), startProjectPhotoUpload: vi.fn(),
}));

import { PortfolioProjects } from "./portfolio-projects";

const photo = (id: string) => ({ kind: "image" as const, id, title: id, state: "ready" as const, isPublic: true,
  previewUrl: `/api/media/portfolio?key=${id}.jpg`, objectKey: `${id}.jpg`, playback: null });

function project(n: number, media = 0): PortfolioProject {
  const items = Array.from({ length: media }, (_, i) => photo(`p${n}-${i}`));
  return { id: `proj-${n}`, title: `Project ${n}`, location: n === 1 ? "New Cairo" : null, description: null,
    isPublic: n === 1, cover: items[2] ? { kind: "image", id: items[2].id } : null, media: items };
}

describe("PortfolioProjects", () => {
  it("draws each project with its count, cover first and a +N tile beyond four thumbnails", () => {
    renderWithI18n(<PortfolioProjects projects={[project(1, 6)]} maxProjects={15} maxMedia={6} videoEnabled={false} />, "en");
    const card = screen.getByTestId("portfolio-project");
    expect(card.textContent).toContain("Project 1");
    expect(card.textContent).toContain("New Cairo");
    expect(card.textContent).toContain("6 / 6");
    expect(card.textContent).toContain("Published");
    expect(card.querySelector("img")?.getAttribute("src")).toContain("p1-2");
    expect(card.textContent).toContain("+1");
    expect(screen.getByTestId("portfolio-add-project").textContent).toContain("1 / 15");
  });

  it("refuses a sixteenth project in the interface too", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => project(i + 1));
    renderWithI18n(<PortfolioProjects projects={fifteen} maxProjects={15} maxMedia={6} videoEnabled={false} />, "en");
    const add = screen.getByTestId("portfolio-add-project") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toContain("You have reached 15 projects");
  });

  it("opens the editor for a new project and shows the database's refusal", async () => {
    renderWithI18n(<PortfolioProjects projects={[]} maxProjects={15} maxMedia={6} videoEnabled={false} />, "ar");
    fireEvent.click(screen.getByTestId("portfolio-add-project"));
    const editor = await screen.findByTestId("portfolio-project-editor");
    expect(within(editor).getByText("مشروع جديد")).toBeTruthy();
    fireEvent.click(within(editor).getByTestId("project-save"));
    expect((await within(editor).findByTestId("project-error")).textContent).toBe("اكتب اسم المشروع.");
  });

  it("accepts only photos while video delivery is off", async () => {
    renderWithI18n(<PortfolioProjects projects={[project(1, 2)]} maxProjects={15} maxMedia={6} videoEnabled={false} />, "en");
    fireEvent.click(screen.getByTestId("portfolio-project-edit"));
    const input = (await screen.findByTestId("project-file-input")) as HTMLInputElement;
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
    expect(screen.getAllByTestId("project-media-item")).toHaveLength(2);
  });
});
