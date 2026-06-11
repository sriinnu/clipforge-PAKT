/**
 * @module tests/fixtures/fat-catalog
 * Realistic 30-tool catalog fixture, modelled on the GitHub MCP server and
 * common filesystem / web-search MCP servers measured at ~42–55k tokens
 * in the Unblocked autopsy (docs/research/2026-06-future-features.md §2).
 *
 * Each tool has:
 * - A verbose multi-sentence description (typical of real MCP servers)
 * - `additionalProperties: false` on the input_schema (redundant boilerplate)
 * - `type: "object"` on the input_schema (also boilerplate)
 * - Several properties with their own verbose descriptions
 * - Null/empty optional fields sprinkled in
 *
 * This fixture is intentionally fat so slim-mode savings tests are meaningful.
 */

import type { ProviderTool } from '../../src/proxy/types.js';

const COMMON_PAGINATION = {
  per_page: {
    type: 'number',
    description:
      'The number of results per page. Must be between 1 and 100 inclusive. ' +
      'If not specified, defaults to 30. Setting this to a high value may increase ' +
      'response time and should be used carefully in contexts with limited resources.',
  },
  page: {
    type: 'number',
    description:
      'Page number to retrieve in a paginated response, starting from 1. ' +
      'If not specified, defaults to the first page. Use in combination with per_page.',
  },
};

/** Shared GitHub auth property description — highly verbose, as in real MCP servers. */
const OWNER_DESC =
  'The account owner of the repository. The name is not case sensitive. ' +
  'This field is required and must match the exact GitHub username or organization name ' +
  'as it appears on GitHub.com. You can find this in the repository URL: ' +
  'https://github.com/{owner}/{repo}. Do not include any special characters or spaces.';

const REPO_DESC =
  'The name of the repository without the .git extension. The name is not case ' +
  'sensitive. This field is required and must match the exact repository name as it ' +
  'appears on GitHub.com. You can find this in the repository URL: ' +
  'https://github.com/{owner}/{repo}.';

const STATE_DESC =
  'Indicates the state of the items to return. Can be either open, closed, or all. ' +
  'Default: open. Use closed to list only closed items, or all to get both open and ' +
  'closed items regardless of their current state in the repository.';

/** Build a fat tool with boilerplate intact (pre-slim). */
function githubTool(
  name: string,
  description: string,
  properties: Record<string, { type: string; description: string; enum?: string[] }>,
  required: string[],
): ProviderTool {
  return {
    name,
    description,
    input_schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

/**
 * Fat 30-tool catalog modelled on the GitHub MCP server and common MCP patterns.
 * Descriptions are deliberately verbose (multi-sentence, padded with usage notes)
 * to simulate the token bloat documented in the Unblocked autopsy.
 */
export const FAT_CATALOG: ProviderTool[] = [
  githubTool(
    'list_issues',
    'List issues in a GitHub repository. Returns a paginated list of issues including their ' +
      'title, body, labels, assignees, and current state. Closed issues can be retrieved by ' +
      'setting the state parameter. The response includes all metadata needed for issue triage. ' +
      'Authentication is required for private repositories and to avoid rate limiting on public ones.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      state: { type: 'string', description: STATE_DESC, enum: ['open', 'closed', 'all'] },
      labels: {
        type: 'string',
        description:
          'A comma-separated list of label names to filter issues by. For example: ' +
          '"bug,enhancement". Only issues with ALL the specified labels will be returned. ' +
          'Labels are case-sensitive and must exist in the repository.',
      },
      ...COMMON_PAGINATION,
    },
    ['owner', 'repo'],
  ),

  githubTool(
    'get_issue',
    'Get a specific issue from a GitHub repository by its number. Returns the full issue ' +
      'object including title, body (in Markdown), labels, assignees, milestone, comments ' +
      'count, reactions summary, and all associated metadata. Use this to inspect a single ' +
      'issue in detail before taking action on it.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      issue_number: {
        type: 'number',
        description:
          'The number that identifies the issue. This is visible in the URL of the issue ' +
          'page and is unique within the repository. Issue numbers are positive integers ' +
          'and are assigned sequentially starting from 1.',
      },
    },
    ['owner', 'repo', 'issue_number'],
  ),

  githubTool(
    'create_issue',
    'Create a new issue in a GitHub repository. Requires write permissions. The issue ' +
      'will be created in the open state by default. You can optionally assign it to ' +
      'users, add labels, link a milestone, and set a body in Markdown format. ' +
      'Returns the full created issue object including its number and URL.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      title: {
        type: 'string',
        description:
          'The title of the issue. Should be concise and descriptive. The title is ' +
          'displayed in issue lists and notifications. Required field, cannot be empty.',
      },
      body: {
        type: 'string',
        description:
          'The contents of the issue body, in Markdown format. Can include headings, ' +
          'bullet lists, code blocks, and task lists. This field is optional but ' +
          'highly recommended for clarity.',
      },
      labels: {
        type: 'string',
        description: 'Comma-separated list of label names to apply to the new issue.',
      },
    },
    ['owner', 'repo', 'title'],
  ),

  githubTool(
    'update_issue',
    'Update an existing issue in a GitHub repository. You can change the title, body, ' +
      'labels, assignees, milestone, and state (open or closed). Only the fields you ' +
      'include will be updated — omitted fields keep their current values. Requires ' +
      'write permission on the repository.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      issue_number: { type: 'number', description: 'The number of the issue to update.' },
      title: { type: 'string', description: 'New title for the issue. Leave undefined to keep existing.' },
      state: { type: 'string', description: 'Set to open or closed.', enum: ['open', 'closed'] },
    },
    ['owner', 'repo', 'issue_number'],
  ),

  githubTool(
    'list_pull_requests',
    'List pull requests for a GitHub repository. Returns a paginated list of open, closed, ' +
      'or all pull requests with their metadata including title, body, source and target ' +
      'branches, review status, merge status, and associated labels and assignees. ' +
      'Useful for tracking ongoing code reviews and merging activity in a repository.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      state: { type: 'string', description: STATE_DESC, enum: ['open', 'closed', 'all'] },
      head: {
        type: 'string',
        description:
          'Filter pulls by head user or head organization and branch name in the format ' +
          'of user:ref-name or organization:ref-name. For example: github:new-script-format ' +
          'or owner:feature-branch.',
      },
      base: {
        type: 'string',
        description: 'Filter pulls by base branch name. For example: main or develop.',
      },
      ...COMMON_PAGINATION,
    },
    ['owner', 'repo'],
  ),

  githubTool(
    'get_pull_request',
    'Get a specific pull request from a GitHub repository. Returns the complete PR object ' +
      'including diff statistics, commit count, changed files, review decisions, merge ' +
      'status, and all associated metadata. Use this to inspect a pull request in detail ' +
      'before merging or reviewing it.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      pull_number: {
        type: 'number',
        description:
          'The number that identifies the pull request within the repository. ' +
          'PR numbers are sequential and visible in the PR URL.',
      },
    },
    ['owner', 'repo', 'pull_number'],
  ),

  githubTool(
    'create_pull_request',
    'Create a new pull request in a GitHub repository. Requires write permissions. ' +
      'You must specify the head branch (the branch with your changes) and the base ' +
      'branch (the branch you want to merge into). The pull request will be created ' +
      'in the open state and can be reviewed and merged using the appropriate tools.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      title: { type: 'string', description: 'The title of the pull request. Required.' },
      head: { type: 'string', description: 'The name of the branch where your changes are implemented.' },
      base: { type: 'string', description: 'The name of the branch you want the changes pulled into.' },
      body: { type: 'string', description: 'The description of the pull request in Markdown.' },
      draft: { type: 'boolean', description: 'Indicates whether the pull request is a draft. Default false.' } as { type: string; description: string },
    },
    ['owner', 'repo', 'title', 'head', 'base'],
  ),

  githubTool(
    'list_commits',
    'List commits on a repository branch. Returns commit metadata including SHA, author, ' +
      'committer, date, and message. You can filter by author and date range. Useful for ' +
      'auditing commit history, finding when a change was introduced, or building changelogs.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      sha: { type: 'string', description: 'SHA or branch to start listing commits from.' },
      author: { type: 'string', description: 'GitHub login or email address by which to filter by commit author.' },
      since: { type: 'string', description: 'Only show results that were last updated after the given time. ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.' },
      until: { type: 'string', description: 'Only commits before this date will be returned. ISO 8601 format.' },
      ...COMMON_PAGINATION,
    },
    ['owner', 'repo'],
  ),

  githubTool(
    'get_commit',
    'Returns the contents of a single commit reference. You must have read access to the repository. ' +
      'Includes the list of files changed, additions and deletions per file, and the diff patch. ' +
      'The combined size of the diff may be large for commits that touch many files.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      ref: { type: 'string', description: 'The commit SHA, branch name, or tag name.' },
    },
    ['owner', 'repo', 'ref'],
  ),

  githubTool(
    'get_file_contents',
    'Gets the contents of a file or directory in a repository. Returns file content as ' +
      'base64-encoded data along with metadata like size, SHA, and download URL. For ' +
      'directories, returns a list of entries. Specify a ref to get contents from a ' +
      'specific branch, tag, or commit SHA.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      path: { type: 'string', description: 'The file path within the repository. Use forward slashes.' },
      ref: { type: 'string', description: 'The branch, tag, or commit SHA to get contents from. Defaults to the repository default branch.' },
    },
    ['owner', 'repo', 'path'],
  ),

  githubTool(
    'create_or_update_file',
    'Creates a new file or updates an existing file in a repository. The content must be ' +
      'provided as a base64-encoded string. If updating an existing file, you must provide ' +
      'the SHA of the file being replaced — this prevents accidentally overwriting concurrent ' +
      'changes. Requires write permission on the repository.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      path: { type: 'string', description: 'The file path to create or update.' },
      message: { type: 'string', description: 'The commit message describing the change.' },
      content: { type: 'string', description: 'The new file content, base64-encoded.' },
      sha: { type: 'string', description: 'Required when updating. The blob SHA of the file being replaced.' },
      branch: { type: 'string', description: 'The branch to commit to. Defaults to the repository default branch.' },
    },
    ['owner', 'repo', 'path', 'message', 'content'],
  ),

  githubTool(
    'delete_file',
    'Deletes a file in a repository. You must provide the SHA of the file blob you want to ' +
      'delete, along with a commit message. This creates a new commit that removes the file ' +
      'from the specified branch. This operation cannot be undone without reverting the commit.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      path: { type: 'string', description: 'The path of the file to delete.' },
      message: { type: 'string', description: 'The commit message for the deletion.' },
      sha: { type: 'string', description: 'The blob SHA of the file being deleted.' },
      branch: { type: 'string', description: 'The branch to delete the file from.' },
    },
    ['owner', 'repo', 'path', 'message', 'sha'],
  ),

  githubTool(
    'search_repositories',
    'Find repositories via various criteria. Returns a list of repositories matching the ' +
      'search query along with metadata including stars, forks, language, license, and ' +
      'description. Useful for discovering relevant open-source projects or finding ' +
      'repositories by topic, language, or owner.',
    {
      query: {
        type: 'string',
        description:
          'The search keywords, along with any qualifiers. Qualifiers can restrict ' +
          'results to repositories of a certain language (language:typescript), by ' +
          'owner (user:octocat), or by topic (topic:llm). Combine multiple qualifiers ' +
          'with spaces.',
      },
      sort: {
        type: 'string',
        description: 'Sort field: stars, forks, help-wanted-issues, or updated.',
        enum: ['stars', 'forks', 'help-wanted-issues', 'updated'],
      },
      order: { type: 'string', description: 'Sort order: asc or desc.', enum: ['asc', 'desc'] },
      ...COMMON_PAGINATION,
    },
    ['query'],
  ),

  githubTool(
    'search_code',
    'Search for code across all repositories. Returns file paths, repository names, and ' +
      'snippets matching the query. The search index is updated roughly every few minutes. ' +
      'Qualifiers like filename:, extension:, path:, language:, repo:, and org: can be ' +
      'combined to narrow results. Rate limits are stricter for unauthenticated requests.',
    {
      query: { type: 'string', description: 'The search keywords and qualifiers, e.g. "addClass in:file language:js".' },
      ...COMMON_PAGINATION,
    },
    ['query'],
  ),

  githubTool(
    'search_issues',
    'Find issues and pull requests by state, label, author, mentions, milestone, and more. ' +
      'Returns a ranked list of matching issues with their full metadata. Supports Boolean ' +
      'operators (AND, OR, NOT) and field qualifiers (assignee:, author:, label:, milestone:, ' +
      'state:, type:) to build complex queries.',
    {
      query: { type: 'string', description: 'The search query string with optional qualifiers.' },
      sort: { type: 'string', description: 'Sort by: comments, reactions, created, updated.', enum: ['comments', 'reactions', 'created', 'updated'] },
      order: { type: 'string', description: 'Sort direction: asc or desc.', enum: ['asc', 'desc'] },
      ...COMMON_PAGINATION,
    },
    ['query'],
  ),

  githubTool(
    'list_branches',
    'List branches for a repository. Returns branch names along with the SHA and commit ' +
      'metadata of the branch tip. Can be filtered to return only protected branches. ' +
      'Use this to discover available branches before checking out or comparing them.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      protected: { type: 'boolean', description: 'Setting to true returns only protected branches.' } as { type: string; description: string },
      ...COMMON_PAGINATION,
    },
    ['owner', 'repo'],
  ),

  githubTool(
    'get_branch',
    'Get a specific branch from a repository. Returns the branch name, the latest commit ' +
      'SHA and metadata, and whether the branch is protected. Use this to inspect a branch ' +
      'before creating a pull request or comparing it with another branch.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      branch: { type: 'string', description: 'The branch name to retrieve. Case-sensitive.' },
    },
    ['owner', 'repo', 'branch'],
  ),

  githubTool(
    'create_branch',
    'Create a branch in a repository from an existing commit, branch, or tag. The new ' +
      'branch will point to the specified SHA. You must have write access to the repository. ' +
      'This is typically the first step before making file changes via create_or_update_file.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      branch: { type: 'string', description: 'The name of the new branch to create.' },
      sha: { type: 'string', description: 'The SHA of the commit to branch from. Must be a full 40-character SHA.' },
    },
    ['owner', 'repo', 'branch', 'sha'],
  ),

  githubTool(
    'list_repositories',
    'List repositories for a user or organization. Returns metadata for each repository ' +
      'including description, visibility, stars, forks, default branch, and topics. ' +
      'Can be filtered by type (all, owner, member) and sorted by various criteria.',
    {
      username: { type: 'string', description: 'The GitHub username or organization name whose repositories to list.' },
      type: { type: 'string', description: 'Limit results to repositories of the specified type. Default: owner.', enum: ['all', 'owner', 'member'] },
      sort: { type: 'string', description: 'The property to sort by: created, updated, pushed, full_name.', enum: ['created', 'updated', 'pushed', 'full_name'] },
      ...COMMON_PAGINATION,
    },
    ['username'],
  ),

  githubTool(
    'create_repository',
    'Create a new repository for the authenticated user or an organization. Supports ' +
      'setting visibility (public/private), initializing with a README, adding a gitignore ' +
      'template, and adding a license. Returns the full repository object including the ' +
      'clone URL and SSH URL.',
    {
      name: { type: 'string', description: 'The name of the repository. Required. Must be URL-safe (alphanumeric, hyphens, underscores).' },
      description: { type: 'string', description: 'A short description of the repository. Optional but recommended.' },
      private: { type: 'boolean', description: 'Set to true to create a private repository. Default false (public).' } as { type: string; description: string },
      auto_init: { type: 'boolean', description: 'Set to true to initialize the repository with a README.' } as { type: string; description: string },
    },
    ['name'],
  ),

  githubTool(
    'fork_repository',
    'Fork a repository. Returns the forked repository object. Forking is asynchronous — ' +
      'the fork may not be ready immediately after the API call returns. If you need to ' +
      'check the fork status, use get_repository a few seconds after forking. ' +
      'Only one fork of a repository per user is allowed.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      organization: { type: 'string', description: 'Optional. The organization to fork into. If not specified, forks into the authenticated user account.' },
    },
    ['owner', 'repo'],
  ),

  githubTool(
    'add_issue_comment',
    'Create a comment on a specific issue or pull request. The comment body supports ' +
      'GitHub-flavored Markdown including @mentions, task lists, and code blocks. ' +
      'Requires write permission on the repository or a token with issues scope. ' +
      'Returns the created comment object with its ID and URL.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      issue_number: { type: 'number', description: 'The number of the issue or pull request to comment on.' },
      body: { type: 'string', description: 'The comment body in GitHub-flavored Markdown.' },
    },
    ['owner', 'repo', 'issue_number', 'body'],
  ),

  githubTool(
    'list_issue_comments',
    'List comments on a specific issue or pull request. Returns comments in chronological ' +
      'order, each with author metadata, body, created/updated timestamps, and reactions. ' +
      'Supports pagination for issues with many comments.',
    {
      owner: { type: 'string', description: OWNER_DESC },
      repo: { type: 'string', description: REPO_DESC },
      issue_number: { type: 'number', description: 'The issue number to list comments for.' },
      since: { type: 'string', description: 'Only comments updated at or after this time are returned. ISO 8601 format.' },
      ...COMMON_PAGINATION,
    },
    ['owner', 'repo', 'issue_number'],
  ),

  // --- Filesystem-style tools (common in desktop MCP servers) ---

  {
    name: 'read_file',
    description:
      'Read the complete contents of a file from the filesystem. Returns the file contents ' +
      'as a UTF-8 string. Only works within the allowed directory. If the file is binary ' +
      'or exceeds the maximum file size limit, an error is returned. Use list_directory ' +
      'to discover available files before reading.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path to the file to read. Must be within the server root directory. ' +
            'Symlinks are followed. Paths outside the root will return a permission error.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },

  {
    name: 'write_file',
    description:
      'Write content to a file at the specified path. Creates the file if it does not ' +
      'exist. Creates parent directories as needed. WARNING: overwrites the existing ' +
      'file content completely without a backup. Use with caution. The content should ' +
      'be a UTF-8 string. Binary data is not supported.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to write the file to.' },
        content: { type: 'string', description: 'The UTF-8 string content to write to the file.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },

  {
    name: 'list_directory',
    description:
      'List the contents of a directory, showing file names, types (file vs directory), ' +
      'sizes, and modification timestamps. Does not recurse into subdirectories by default. ' +
      'Set recursive to true to get a tree view. Hidden files (starting with .) are ' +
      'included by default.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory to list.' },
        recursive: { type: 'boolean', description: 'If true, recursively lists subdirectories.' } as { type: string; description: string },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },

  {
    name: 'move_file',
    description:
      'Move or rename a file or directory from one path to another. If the destination ' +
      'path already exists and is a file, it will be overwritten. If the destination is ' +
      'a directory, the source is moved inside it. Requires write permissions on both ' +
      'the source and destination parent directories.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The current path of the file or directory.' },
        destination: { type: 'string', description: 'The target path to move the file or directory to.' },
      },
      required: ['source', 'destination'],
      additionalProperties: false,
    },
  },

  {
    name: 'search_files',
    description:
      'Recursively search for files and directories matching a pattern. Supports glob ' +
      'patterns (e.g., "**/*.ts", "src/**/*.json"). Returns matching paths relative to ' +
      'the search root. Excludes node_modules and .git directories by default. ' +
      'Useful for finding files before reading or editing them.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Starting directory for the recursive search.' },
        pattern: { type: 'string', description: 'Glob pattern to match against file and directory names.' },
        exclude_patterns: { type: 'string', description: 'Comma-separated glob patterns to exclude from results.' },
      },
      required: ['path', 'pattern'],
      additionalProperties: false,
    },
  },

  {
    name: 'execute_command',
    description:
      'Execute a shell command in a specified working directory. Returns stdout, stderr, ' +
      'and exit code. Commands run in an isolated shell context with restricted environment ' +
      'variables. Timeouts apply (default 30 seconds). Use this sparingly and prefer ' +
      'higher-level tools when available. Destructive commands require explicit confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute. Must be a single line.' },
        cwd: { type: 'string', description: 'Working directory for the command. Defaults to the server root.' },
        timeout_ms: { type: 'number', description: 'Maximum execution time in milliseconds. Default 30000. Maximum 120000.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },

  // --- Web search / browser tool ---

  {
    name: 'web_search',
    description:
      'Search the web using a search engine. Returns a list of results including title, ' +
      'URL, and a snippet of the page content. Results are ranked by relevance. Use ' +
      'specific, focused queries for best results. This tool does not browse URLs — ' +
      'use fetch_url to retrieve the full content of a specific page.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The search query. Use natural language or keyword phrases. Boolean operators ' +
            '(AND, OR, NOT) and site: qualifiers are supported by some search engines. ' +
            'Keep queries under 256 characters for best results.',
        },
        num_results: {
          type: 'number',
          description: 'Number of results to return. Default 10, maximum 50.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },

  {
    name: 'fetch_url',
    description:
      'Fetch the content of a URL and return it as text. HTML pages are converted to ' +
      'clean Markdown. PDF files are extracted as text. Binary files return an error. ' +
      'JavaScript-rendered content may not be available — use this for static pages and ' +
      'APIs that return JSON or text. Redirects are followed automatically up to 5 hops.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full URL to fetch, including the scheme (https:// or http://).' },
        timeout_ms: { type: 'number', description: 'Request timeout in milliseconds. Default 10000.' },
        headers: { type: 'object', description: 'Optional HTTP headers to include in the request.' } as { type: string; description: string },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
];
