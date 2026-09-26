
from rag import ask_question


def main():
    print("\n♟️ Chess RAG Chatbot")
    print("--------------------")
    print("Type 'exit' to quit.\n")

    while True:
        question = input("You: ").strip()

        if question.lower() == "exit":
            print("Goodbye!")
            break

        if not question:
            continue

        try:
            answer = ask_question(question)
            print(f"\n🤖 Assistant: {answer}\n")

        except Exception as error:
            print(f"\n❌ Error: {error}\n")


if __name__ == "__main__":
    main()