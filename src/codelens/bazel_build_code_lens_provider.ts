// Copyright 2018 The Bazel Authors. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as path from "path";
import * as vscode from "vscode";
import { BazelQuery, getBazelWorkspaceFolder, QueryLocation } from "../bazel";
import { blaze_query } from "../protos";
import { CodeLensCommandAdapter } from "./code_lens_command_adapter";

/** Provids CodeLenses for targets in Bazel BUILD files. */
export class BazelBuildCodeLensProvider implements vscode.CodeLensProvider {
  public onDidChangeCodeLenses: vscode.Event<void>;

  /** Fired when BUILD files change in the workspace. */
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  /**
   * Initializes a new CodeLens provider with the given extension context.
   *
   * @param context The VS Code extension context.
   */
  constructor(private context: vscode.ExtensionContext) {
    this.onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

    const buildWatcher = vscode.workspace.createFileSystemWatcher(
      "**/{BUILD,BUILD.bazel}",
      true, // ignoreCreateEvents
      false,
      true, // ignoreDeleteEvents
    );
    buildWatcher.onDidChange(
      (uri) => {
        this.onDidChangeCodeLensesEmitter.fire();
      },
      this,
      context.subscriptions,
    );
  }

  /**
   * Provides promisified CodeLen(s) for the given document.
   *
   * @param document A Bazel BUILD file
   * @param token CodeLens token automatically generated by VS Code when
   *     invoking the provider
   */
  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (document.isDirty) {
      // Don't show code lenses for dirty BUILD files; we can't reliably
      // determine what the build targets in it are until it is saved and we can
      // invoke `bazel query` with the updated file.
      return [];
    }

    const workspace = getBazelWorkspaceFolder(document.uri.fsPath);
    if (workspace === undefined) {
      vscode.window.showWarningMessage(
        "Bazel BUILD CodeLens unavailable as currently opened file is not in " +
          "a Bazel workspace",
      );
      return [];
    }
    // Path to the BUILD file relative to the workspace.
    const relPathToDoc = path.relative(workspace, document.uri.fsPath);
    // Strip away the name of the BUILD file from the relative path.
    let relDirWithDoc = path.dirname(relPathToDoc);
    // Strip away the "." if the BUILD file was in the same directory as the
    // workspace.
    if (relDirWithDoc === ".") {
      relDirWithDoc = "";
    }
    // Turn the relative path into a package label
    const pkg = `//${relDirWithDoc}`;
    const queryResult = await new BazelQuery(
      workspace,
      `'kind(rule, ${pkg}:all)'`,
      [],
    ).queryTargets();

    return this.computeCodeLenses(workspace, queryResult);
  }

  /**
   * Takes the result of a Bazel query for targets defined in a package and
   * returns a list of CodeLens for the BUILD file in that package.
   *
   * @param bazelWorkspaceDirectory The Bazel workspace directory.
   * @param queryResult The result of the bazel query.
   */
  private computeCodeLenses(
    bazelWorkspaceDirectory: string,
    queryResult: blaze_query.QueryResult,
  ): vscode.CodeLens[] {
    const result = [];

    for (const target of queryResult.target) {
      const location = new QueryLocation(target.rule.location);
      const targetName = target.rule.name;
      const ruleClass = target.rule.ruleClass;
      let cmd: vscode.Command;
      if (ruleClass.endsWith("_test") || ruleClass === "test_suite") {
        cmd = {
          arguments: [
            new CodeLensCommandAdapter(bazelWorkspaceDirectory, [targetName]),
          ],
          command: "bazel.testTarget",
          title: `Test ${targetName}`,
          tooltip: `Test ${targetName}`,
        };
      } else {
        cmd = {
          arguments: [
            new CodeLensCommandAdapter(bazelWorkspaceDirectory, [targetName]),
          ],
          command: "bazel.buildTarget",
          title: `Build ${targetName}`,
          tooltip: `Build ${targetName}`,
        };
      }
      result.push(new vscode.CodeLens(location.range, cmd));
    }

    return result;
  }
}