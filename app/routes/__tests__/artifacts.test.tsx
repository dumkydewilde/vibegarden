import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Artifacts from "../artifacts";
import { ArtifactUploadDialog } from "~/components/artifacts/artifact-upload-dialog";

const projects = Array.from({ length: 7 }, (_, index) => ({
  id: `project-${index + 1}`,
  title: `Project ${index + 1}`,
}));

const artifacts = projects.map((project, index) => ({
  id: `artifact-${index + 1}`,
  project,
  title: `Artifact ${index + 1}`,
  description: null,
  type: index === 0 ? "html" : index === 1 ? "link" : "file",
  visibility: index === 1 ? "gallery" : "private",
  currentVersion: { id: `version-${index + 1}`, number: index + 1, source: "web", createdAt: 0 },
  galleryVersion: null,
  updatedAt: Date.UTC(2026, 6, 19),
  url: `/artifacts/artifact-${index + 1}`,
}));

function renderArtifacts(data = { artifacts, projects }) {
  const Stub = createRoutesStub([
    { path: "/artifacts", Component: Artifacts, loader: () => data },
  ]);
  render(<Stub initialEntries={["/artifacts"]} />);
}

describe("Artifacts", () => {
  it("groups owned artifact cards by project and discloses overflow groups", async () => {
    renderArtifacts();

    expect(await screen.findByRole("heading", { name: "Project 1" })).toBeInTheDocument();
    expect(screen.getByText("HTML")).toBeInTheDocument();
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Visibility: private").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Project 7" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show 1 more project/i }));
    expect(await screen.findByRole("heading", { name: "Project 7" })).toBeInTheDocument();
  });

  it("enables upload from the empty state", async () => {
    renderArtifacts({ artifacts: [], projects: [] });
    expect((await screen.findAllByRole("button", { name: /upload artifact/i }))[0]).toBeEnabled();
  });
});

describe("ArtifactUploadDialog", () => {
  it("moves from kind through project and metadata with owner-confirmed origins", async () => {
    render(<ArtifactUploadDialog projects={projects.slice(0, 1)} />);

    fireEvent.click(screen.getByRole("button", { name: /upload artifact/i }));
    fireEvent.click(await screen.findByRole("button", { name: /a link/i }));
    expect(screen.getByText(/choose a project/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Project 1"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByLabelText(/link url/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/link url/i), {
      target: { value: "https://data.example.com/report" },
    });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Research report" } });
    expect(await screen.findByText(/https:\/\/data\.example\.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create artifact/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/allow data\.example\.com/i));
    expect(screen.getByRole("button", { name: /create artifact/i })).toBeEnabled();
  });
});
