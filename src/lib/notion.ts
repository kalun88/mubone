import { Client } from "@notionhq/client";
import type {
  Post,
  Block,
  Paragraph,
  Heading1,
  Heading2,
  Heading3,
  BulletedListItem,
  NumberedListItem,
  ToDo,
  NImage,
  Code,
  Quote,
  Equation,
  Callout,
  Embed,
  Video,
  File,
  Bookmark,
  LinkPreview,
  SyncedBlock,
  SyncedFrom,
  Table,
  TableRow,
  TableCell,
  Toggle,
  ColumnList,
  Column,
  TableOfContents,
  RichText,
  Text,
  Annotation,
  SelectProperty,
  Emoji,
  FileObject,
  LinkToPage,
  NAudio,
  External,
} from "./interfaces";

const NOTION_API_SECRET = import.meta.env.NOTION_API_SECRET;
const DATABASE_ID = import.meta.env.DATABASE_ID;

const client = new Client({
  auth: NOTION_API_SECRET,
});

export async function getAllPosts(): Promise<Post[]> {
  if (!NOTION_API_SECRET || !DATABASE_ID) {
    console.warn(
      "NOTION_API_SECRET or DATABASE_ID not set. Returning empty posts array."
    );
    return [];
  }

  try {
    const response = await client.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: "Published",
        checkbox: {
          equals: true,
        },
      },
      sorts: [
        {
          property: "Date",
          direction: "descending",
        },
      ],
    });

    const posts: Post[] = [];
    for (const page of response.results) {
      const post = _buildPost(page as any);
      if (post) {
        posts.push(post);
      }
    }

    return posts;
  } catch (error) {
    console.error("Error fetching posts from Notion:", error);
    return [];
  }
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  if (!NOTION_API_SECRET || !DATABASE_ID) {
    return null;
  }

  try {
    const response = await client.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: "Slug",
            rich_text: {
              equals: slug,
            },
          },
          {
            property: "Published",
            checkbox: {
              equals: true,
            },
          },
        ],
      },
    });

    if (response.results.length === 0) {
      return null;
    }

    return _buildPost(response.results[0] as any);
  } catch (error) {
    console.error("Error fetching post by slug:", error);
    return null;
  }
}

export async function getPostContent(pageId: string): Promise<Block[]> {
  if (!NOTION_API_SECRET) {
    return [];
  }

  try {
    const blocks = await _getBlockChildren(pageId);
    return blocks;
  } catch (error) {
    console.error("Error fetching post content:", error);
    return [];
  }
}

async function _getBlockChildren(blockId: string): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;

  try {
    while (true) {
      const response = await client.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
      });

      for (const blockObj of response.results) {
        const block = await _buildBlock(blockObj as any);
        if (block) {
          blocks.push(block);
        }
      }

      if (!response.has_more) {
        break;
      }
      cursor = response.next_cursor || undefined;
    }
  } catch (error) {
    console.error(`Error fetching block children for ${blockId}:`, error);
  }

  return blocks;
}

async function _buildBlock(blockObj: any): Promise<Block | null> {
  const block: Block = {
    Id: blockObj.id,
    Type: blockObj.type,
    HasChildren: blockObj.has_children,
    LastUpdatedTimeStamp: new Date(blockObj.last_edited_time),
  };

  const blockData = blockObj[blockObj.type];

  switch (blockObj.type) {
    case "paragraph":
      block.Paragraph = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Color: blockData.color || "default",
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "heading_1":
      block.Heading1 = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Color: blockData.color || "default",
        IsToggleable: blockData.is_toggleable || false,
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "heading_2":
      block.Heading2 = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Color: blockData.color || "default",
        IsToggleable: blockData.is_toggleable || false,
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "heading_3":
      block.Heading3 = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Color: blockData.color || "default",
        IsToggleable: blockData.is_toggleable || false,
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "bulleted_list_item":
      block.BulletedListItem = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Color: blockData.color || "default",
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "numbered_list_item":
      block.NumberedListItem = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Color: blockData.color || "default",
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "to_do":
      block.ToDo = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Checked: blockData.checked || false,
        Color: blockData.color || "default",
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "image":
      block.NImage = _buildImage(blockData);
      break;

    case "video":
      block.Video = _buildVideo(blockData);
      break;

    case "audio":
      block.NAudio = _buildAudio(blockData);
      break;

    case "file":
      block.File = _buildFile(blockData);
      break;

    case "code":
      block.Code = {
        Caption: _buildRichTexts(blockData.caption),
        RichTexts: _buildRichTexts(blockData.rich_text),
        Language: blockData.language || "plaintext",
      };
      break;

    case "quote":
      block.Quote = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Color: blockData.color || "default",
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "equation":
      block.Equation = {
        Expression: blockData.expression || "",
      };
      break;

    case "callout":
      block.Callout = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Icon: _buildIcon(blockData.icon),
        Color: blockData.color || "default",
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "synced_block":
      block.SyncedBlock = {
        SyncedFrom: blockData.synced_from
          ? {
              BlockId: blockData.synced_from.block_id,
            }
          : null,
        Children: blockObj.has_children
          ? await _getBlockChildren(blockObj.id)
          : undefined,
      };
      break;

    case "toggle":
      block.Toggle = {
        RichTexts: _buildRichTexts(blockData.rich_text),
        Color: blockData.color || "default",
        Children: await _getBlockChildren(blockObj.id),
      };
      break;

    case "embed":
      block.Embed = {
        Caption: _buildRichTexts(blockData.caption),
        Url: blockData.url || "",
      };
      break;

    case "bookmark":
      block.Bookmark = {
        Caption: _buildRichTexts(blockData.caption),
        Url: blockData.url || "",
      };
      break;

    case "link_preview":
      block.LinkPreview = {
        Caption: _buildRichTexts(blockData.caption),
        Url: blockData.url || "",
      };
      break;

    case "table":
      block.Table = await _buildTable(blockObj.id, blockData);
      break;

    case "column_list":
      block.ColumnList = await _buildColumnList(blockObj.id);
      break;

    case "table_of_contents":
      block.TableOfContents = {
        Color: blockData.color || "default",
      };
      break;

    case "link_to_page":
      block.LinkToPage = {
        Type: blockData.type || "page_id",
        PageId: blockData.page_id || "",
      };
      break;

    case "divider":
      // Divider blocks don't have any special data
      break;

    default:
      return null;
  }

  return block;
}

function _buildRichTexts(richTextObjects: any[]): RichText[] {
  return richTextObjects.map((rt) => _buildRichText(rt));
}

function _buildRichText(rt: any): RichText {
  const annotation: Annotation = {
    Bold: rt.annotations.bold,
    Italic: rt.annotations.italic,
    Strikethrough: rt.annotations.strikethrough,
    Underline: rt.annotations.underline,
    Code: rt.annotations.code,
    Color: rt.annotations.color,
  };

  const richText: RichText = {
    Annotation: annotation,
    PlainText: rt.plain_text,
    Href: rt.href || undefined,
  };

  if (rt.type === "text") {
    richText.Text = {
      Content: rt.text.content,
      Link: rt.text.link
        ? {
            Url: rt.text.link.url,
          }
        : undefined,
    };
  }

  if (rt.type === "equation") {
    richText.Equation = {
      Expression: rt.equation.expression,
    };
  }

  if (rt.type === "mention") {
    richText.Mention = _buildMention(rt.mention);
  }

  return richText;
}

function _buildMention(mention: any): any {
  const result: any = {
    Type: mention.type,
  };

  if (mention.type === "page") {
    result.Page = {
      PageId: mention.page.id,
      Type: mention.page.type,
    };
  }

  if (mention.type === "date") {
    result.DateStr = mention.date.start;
  }

  if (mention.type === "link_mention") {
    result.LinkMention = mention.link_mention;
  }

  if (mention.type === "custom_emoji") {
    result.CustomEmoji = mention.custom_emoji;
  }

  return result;
}

function _buildIcon(icon: any): FileObject | Emoji | null {
  if (!icon) return null;

  if (icon.type === "emoji") {
    return {
      Type: "emoji",
      Emoji: icon.emoji,
    };
  }

  if (icon.type === "external") {
    return {
      Type: "external",
      Url: icon.external.url,
    };
  }

  if (icon.type === "file") {
    return {
      Type: "file",
      Url: icon.file.url,
      ExpiryTime: icon.file.expiry_time,
    };
  }

  return null;
}

function _buildImage(imageData: any): NImage {
  return {
    Caption: _buildRichTexts(imageData.caption),
    Type: imageData.type,
    File: imageData.file
      ? {
          Type: "file",
          Url: imageData.file.url,
          ExpiryTime: imageData.file.expiry_time,
        }
      : undefined,
    External: imageData.external
      ? {
          Url: imageData.external.url,
        }
      : undefined,
  };
}

function _buildVideo(videoData: any): Video {
  return {
    Caption: _buildRichTexts(videoData.caption),
    Type: videoData.type,
    External: videoData.external
      ? {
          Url: videoData.external.url,
        }
      : undefined,
    File: videoData.file
      ? {
          Type: "file",
          Url: videoData.file.url,
          ExpiryTime: videoData.file.expiry_time,
        }
      : undefined,
  };
}

function _buildAudio(audioData: any): NAudio {
  return {
    Caption: _buildRichTexts(audioData.caption),
    Type: audioData.type,
    External: audioData.external
      ? {
          Url: audioData.external.url,
        }
      : undefined,
    File: audioData.file
      ? {
          Type: "file",
          Url: audioData.file.url,
          ExpiryTime: audioData.file.expiry_time,
        }
      : undefined,
  };
}

function _buildFile(fileData: any): File {
  return {
    Caption: _buildRichTexts(fileData.caption),
    Type: fileData.type,
    File: fileData.file
      ? {
          Type: "file",
          Url: fileData.file.url,
          ExpiryTime: fileData.file.expiry_time,
        }
      : undefined,
    External: fileData.external
      ? {
          Url: fileData.external.url,
        }
      : undefined,
  };
}

async function _buildTable(blockId: string, tableData: any): Promise<Table> {
  const rows: TableRow[] = [];
  let cursor: string | undefined;

  try {
    while (true) {
      const response = await client.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
      });

      for (const rowObj of response.results) {
        if (rowObj.type === "table_row") {
          const rowData = rowObj.table_row;
          const cells: TableCell[] = rowData.cells.map((cellData: any) => ({
            RichTexts: _buildRichTexts(cellData),
          }));

          rows.push({
            Id: rowObj.id,
            Type: "table_row",
            HasChildren: rowObj.has_children,
            Cells: cells,
          });
        }
      }

      if (!response.has_more) break;
      cursor = response.next_cursor || undefined;
    }
  } catch (error) {
    console.error(`Error fetching table rows for ${blockId}:`, error);
  }

  return {
    TableWidth: tableData.table_width || 0,
    HasColumnHeader: tableData.has_column_header || false,
    HasRowHeader: tableData.has_row_header || false,
    Rows: rows,
  };
}

async function _buildColumnList(blockId: string): Promise<ColumnList> {
  const columns: Column[] = [];

  try {
    const response = await client.blocks.children.list({
      block_id: blockId,
    });

    for (const colObj of response.results) {
      if (colObj.type === "column") {
        const children = await _getBlockChildren(colObj.id);
        columns.push({
          Id: colObj.id,
          Type: "column",
          HasChildren: colObj.has_children,
          Children: children,
        });
      }
    }
  } catch (error) {
    console.error(`Error fetching columns for ${blockId}:`, error);
  }

  return {
    Columns: columns,
  };
}

function _buildPost(pageObj: any): Post | null {
  const properties = pageObj.properties;

  // Extract properties
  const titleProp = properties.Name;
  const slugProp = properties.Slug;
  const dateProp = properties.Date;
  const typeProp = properties.Type;
  const showProp = properties["Show on Homepage"];
  const pinOrderProp = properties["Pin Order"];
  const excerptProp = properties.Excerpt;
  const imageProp = properties["Featured Image"];
  const tagsProp = properties.Tags;

  if (!titleProp || !slugProp) {
    return null;
  }

  // Extract title
  const title =
    titleProp.title && titleProp.title.length > 0
      ? titleProp.title[0].plain_text
      : "";

  // Extract slug
  const slug =
    slugProp.rich_text && slugProp.rich_text.length > 0
      ? slugProp.rich_text[0].plain_text
      : "";

  // Extract date
  const date = dateProp?.date?.start || "";

  // Extract type
  const type =
    typeProp?.select?.name || "blog";

  // Extract show on homepage
  const showOnHomepage = showProp?.checkbox || false;

  // Extract pin order (null = unpinned)
  const pinOrder: number | null = pinOrderProp?.number ?? null;

  // Extract excerpt
  const excerpt =
    excerptProp?.rich_text && excerptProp.rich_text.length > 0
      ? excerptProp.rich_text[0].plain_text
      : "";

  // Extract featured image
  let featuredImage: string | null = null;
  if (imageProp?.files && imageProp.files.length > 0) {
    const file = imageProp.files[0];
    if (file.type === "file") {
      featuredImage = file.file.url;
    } else if (file.type === "external") {
      featuredImage = file.external.url;
    }
  }

  // Extract tags
  const tags: SelectProperty[] = [];
  if (tagsProp?.multi_select) {
    for (const tag of tagsProp.multi_select) {
      tags.push({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        description: "",
      });
    }
  }

  return {
    PageId: pageObj.id,
    Title: title,
    Slug: slug,
    Date: date,
    Type: type,
    ShowOnHomepage: showOnHomepage,
    PinOrder: pinOrder,
    Excerpt: excerpt,
    FeaturedImage: featuredImage,
    Tags: tags,
    LastUpdatedTimeStamp: new Date(pageObj.last_edited_time),
  };
}
