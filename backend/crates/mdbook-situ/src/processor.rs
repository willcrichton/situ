use mdbook::{
  book::{Book, Chapter},
  errors::Error,
  preprocess::{Preprocessor, PreprocessorContext},
  BookItem,
};
use pulldown_cmark::{CowStr, Event, InlineStr, Parser};
use pulldown_cmark_to_cmark::cmark;
use regex::Regex;

pub struct SituProcessor;

fn to_cowstr(s: impl Into<String>) -> CowStr<'static> {
  let s: String = s.into();
  CowStr::Boxed(s.into_boxed_str())
}

impl SituProcessor {
  pub fn new() -> Self {
    SituProcessor
  }

  fn process_chapter(&self, ctx: &PreprocessorContext, chapter: &mut Chapter) {
    let events = Parser::new(&chapter.content);

    let mut new_events = Vec::new();
    for event in events {
      let new_event = match &event {
        Event::Text(text) => {
          let text = text.as_ref();
          if text == "{{#quiz}}" {
            // TODO: inject inline div?
            Event::Html(to_cowstr(format!("{}", ctx.root.display())))
          } else {
            event
          }
        }
        _ => event,
      };
      new_events.push(new_event);
    }

    let mut new_content = String::new();
    // TODO: inject script header

    cmark(new_events.into_iter(), &mut new_content).unwrap();
    chapter.content = new_content;
  }
}

impl Preprocessor for SituProcessor {
  fn name(&self) -> &str {
    "situ"
  }

  fn run(&self, ctx: &PreprocessorContext, mut book: Book) -> Result<Book, Error> {
    book.for_each_mut(|item| {
      if let BookItem::Chapter(chapter) = item {
        self.process_chapter(ctx, chapter);
      }
    });

    Ok(book)
  }

  fn supports_renderer(&self, renderer: &str) -> bool {
    renderer != "not-supported"
  }
}
