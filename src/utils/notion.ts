import { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { Digest } from "../types";
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

export default class NotionService {
  async updateMorningBriefDb(digest: Digest) {
    try {
      const monthPage = await this.handlePageContext();
      const dayPage = await this.createDayPage(monthPage.id, digest);
      return dayPage;
    } catch (error) {
      console.error("Error updating Notion:", error);
      throw new Error(`Notion Error: ${error}`);
    }
  }

  async handlePageContext(parentId: string = "75b22e80-f388-41e8-a02c-2a88d879df5b") {
    const response = await notion.blocks.children.list({ block_id: parentId });
    const nestedPages = response.results.filter(
      (block): block is BlockObjectResponse => "type" in block && block.type === "child_page",
    );
    const currentMonth = new Date().toLocaleString("default", { month: "long" });

    for (const page of nestedPages) {
      if ("child_page" in page) {
        const pageTitle = page.child_page.title;
        if (pageTitle.includes(currentMonth)) {
          return page;
        }
      }
    }

    const newMonthPage = await notion.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: [
          {
            text: {
              content: currentMonth,
            },
          },
        ],
      },
    });

    return newMonthPage;
  }

  async createDayPage(monthPageId: string, digest: Digest) {
    const date = new Date();
    const day = date.getDate();
    const month = date.toLocaleString("en-US", { month: "long" });

    const getOrdinalSuffix = (n: number) => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    const title = `${month} ${getOrdinalSuffix(day)}`;

    try {
      const blocks = this.convertContentToBlocks(digest.content);

      const response = await notion.pages.create({
        parent: { page_id: monthPageId },
        properties: {
          title: {
            title: [{ type: "text", text: { content: title } }],
          },
        },
        children: blocks,
      });

      return response;
    } catch (error) {
      console.error("Error creating day page in Notion:", error);
      throw new Error(`Failed to create day page in Notion: ${error}`);
    }
  }

  convertContentToBlocks(content: string): Array<any> {
    const lines = content.split("\n");
    const blocks = [];
    let currentParagraph = "";
    let skipIntroduction = true;

    for (const line of lines) {
      // Skip the introduction section
      if (skipIntroduction) {
        if (line.trim() === "---") {
          skipIntroduction = false;
        }
        continue;
      }

      if (line.startsWith("# ")) {
        if (currentParagraph) {
          blocks.push(this.createParagraphBlock(currentParagraph));
          currentParagraph = "";
        }
        blocks.push(this.createHeadingBlock(line.substring(2), "heading_1"));
      } else if (line.startsWith("## ")) {
        if (currentParagraph) {
          blocks.push(this.createParagraphBlock(currentParagraph));
          currentParagraph = "";
        }
        blocks.push(this.createHeadingBlock(line.substring(3), "heading_2"));
      } else if (line.startsWith("### ")) {
        if (currentParagraph) {
          blocks.push(this.createParagraphBlock(currentParagraph));
          currentParagraph = "";
        }
        blocks.push(this.createHeadingBlock(line.substring(4), "heading_3"));
      } else if (line.startsWith("- ")) {
        if (currentParagraph) {
          blocks.push(this.createParagraphBlock(currentParagraph));
          currentParagraph = "";
        }
        blocks.push(this.createBulletedListItemBlock(line.substring(2)));
      } else if (line.trim() === "") {
        if (currentParagraph) {
          blocks.push(this.createParagraphBlock(currentParagraph));
          currentParagraph = "";
        }
      } else {
        currentParagraph += line;
      }
    }

    if (currentParagraph) {
      blocks.push(this.createParagraphBlock(currentParagraph));
    }

    return blocks.filter((block) => block !== null);
  }

  createHeadingBlock(content: string, type: "heading_1" | "heading_2" | "heading_3") {
    const filteredContent = content.replace(/@\(\[.*?\]\(.*?\)\)/g, "");

    return {
      object: "block",
      type: type,
      [type]: {
        rich_text: [{ type: "text", text: { content: filteredContent.trim() } }],
      },
    };
  }

  createParagraphBlock(content: string) {
    const filteredContent = content.includes("AI Summarized") ? "" : content;

    return filteredContent === ""
      ? null
      : {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: this.parseRichText(filteredContent),
          },
        };
  }

  parseRichText(content: string): Array<any> {
    const parts = content.split(/(\[.*?\]\(.*?\))/);

    return parts.map((part) => {
      if (part.startsWith("[") && part.includes("](")) {
        const [text, url] = part.slice(1, -1).split("](");
        return {
          type: "text",
          text: { content: text, link: { url } },
        };
      } else {
        return { type: "text", text: { content: part } };
      }
    });
  }

  createBulletedListItemBlock(content: string) {
    return {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: this.parseRichText(content),
      },
    };
  }

  splitContentIntoBlocks(content: string): Array<any> {
    const paragraphs = content.split("\n\n");

    return paragraphs.map((paragraph) => {
      if (paragraph.startsWith("#")) {
        // Handle headings
        const match = paragraph.match(/^#+/);
        if (match) {
          const level = match[0].length;
          const headingType = `heading_${level}` as "heading_1" | "heading_2" | "heading_3";
          return {
            object: "block",
            type: headingType,
            [headingType]: {
              rich_text: [{ type: "text", text: { content: paragraph.replace(/^#+\s/, "") } }],
            },
          };
        }
        // ... existing code ...
      } else if (paragraph.startsWith("- ")) {
        // Handle bullet lists
        return {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [{ type: "text", text: { content: paragraph.substring(2) } }],
          },
        };
      } else {
        // Regular paragraphs
        return {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: paragraph.trim() } }],
          },
        };
      }
    });
  }
}
