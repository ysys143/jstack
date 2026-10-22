/** Bash commands the model-version tests judge, shared by the model-versions-*.test.ts files. */
import { checkModelStatus, getAllModelNames } from '../../../scripts/models_database.js';
// A bare name the provider patterns recognise, so a data-only mention would have matched before.
export const bashSample = () => [...getAllModelNames()].find(name => { const [old, info] = checkModelStatus(name); return old && info?.status === 'outdated' && !info.warn_only && /^(claude|gpt|gemini)-[a-z0-9.-]+$/.test(name); })!;
/** Bash commands by expected verdict: data passes, a file write warns, a selection blocks. */
export function bashCases(m: string): { data: string[]; written: string[]; selected: string[] } {
    return {
        // Search, print, record, query and test-filter commands carry the name as a term or text, even in a selection shape.
        data: [
            `grep -A6 '"${m}"' db.ts`, `grep -rn ${m} src/`, `rg -n '"model": "${m}"' logs/ | head`, `jq '.[] | select(.model == "${m}")' runs.json`,
            `jq -n '{model: "${m}"}'`, `echo ${m}`, `printf '%s\\n' ${m}`, `echo "use --model ${m}"`, `echo "it's" ; echo "--model ${m}"`,
            `git commit -m "bump ${m}"`, `git commit -m "default model=${m}"`, `git log --grep='model="${m}"'`, `git -C /tmp/repo log -S 'model="${m}"'`,
            `git --no-pager log -G '"model": "${m}"'`, `git -c user.name=x commit -m "${m} is outdated"`, `git -c user.name=x commit -m "fix: default model=${m} replaced"`,
            `git grep -n 'model="${m}"'`, `git show HEAD~1 | grep 'model="${m}"'`, `git tag -a v1 -m "${m} era"`, `git stash push -m "${m} experiment"`,
            `find . -name '*.py' | xargs grep -l 'model="${m}"'`, `find . -name '*.py' -exec grep -l 'model="${m}"' {} +`, `LC_ALL=C grep -rn 'model="${m}"' src`,
            `sudo grep 'model="${m}"' /etc/app.conf`, `egrep 'model="${m}"' src/app.py`, `sed -n '/model="${m}"/p' src/app.py`, `awk '/"model": "${m}"/' usage.jsonl`,
            `sqlite3 usage.db "select count(*) from runs where model = '${m}'"`, `duckdb -c "select * from 'usage.jsonl' where model='${m}'"`,
            `gh issue create --title "x" --body "replace --model ${m} in docs"`, `gh pr create --title "drop ${m}" --body "model=${m} is retired"`,
            `python -m pytest -k ${m}`, `cat README.md # see --model ${m}`, `count=$(grep -c 'model="${m}"' usage.jsonl)`, `echo "$(grep -h ${m} notes.txt)"`,
            `cd results/${m} && ls`, `for f in $(grep -l ${m} src); do echo $f; done`, `while read f; do echo $f; done < <(grep -l ${m} src)`,
            `diff <(grep ${m} a) <(grep ${m} b)`, `sed 's/x/${m}/' notes.txt | head`,
            // A loop or assignment whose values only reach data commands is data too.
            `for m in ${m} other; do grep -c "$m" usage.jsonl; done`, `for f in results/${m}/*.json; do jq .score "$f"; done`,
            `export HITS=$(grep -c ${m} usage.jsonl)`, `echo ${m} | while read m; do grep -c "$m" f; done`,
            // A test filter, a GET query and a git command that runs only data commands stay data.
            `pytest tests -k ${m} -x 2>&1 | tail -20`, `uv run pytest -k "${m} and not slow"`, `gh api -X GET search/code -f q="${m} in:file"`,
            `gh issue comment 131 --body "Still blocks on ${m}"`, `git -c core.pager=less log --grep=${m}`, `git submodule foreach 'git log --oneline | grep ${m}'`,
            `if [[ "$MODEL" == "${m}" ]]; then echo retired; fi`, `tar czf results-${m}.tgz results/${m}`, `rsync -av results/${m}/ backup/`,
            `aws s3 cp results/${m}/ s3://bucket/ --recursive`, `zip -r ${m}.zip results/${m}`, `scp results/${m}.json host:/tmp/`,
            `uvx pytest -k ${m}`, `pdm run pytest -k ${m}`, `hatch run pytest -k ${m}`, `fd -e py -x grep -l ${m}`,
            // Loop control and sleeps do not make a data loop run something; a search stored in an array is data.
            `for m in ${m} other; do grep -q "$m" f && break; done`, `for m in ${m} other; do grep -c "$m" f; sleep 1; done`,
            `for m in ${m} other; do grep -c "$m" f || continue; done`, `select m in ${m} other; do grep -c "$m" usage.jsonl; break; done`,
            `mapfile -t files < <(grep -rl ${m} src)`, `readarray -t files < <(grep -rl ${m} src)`,
            `while read -r f; do python lint.py "$f"; done < <(grep -rl ${m} src)`,
            // pytest test paths, node ids and path options are data, whichever flag precedes them.
            `pytest -v "tests/test_chat.py::test_chat[${m}]"`, `pytest -x tests/${m}/test_eval.py`, `pytest --lf tests/${m}/`,
            `pytest -q --deselect "tests/test_chat.py::test_chat[${m}]"`, `pytest -k ${m} --junitxml=reports/${m}/junit.xml`,
            `time -p grep -rn ${m} src`, `ionice -c3 grep -rn ${m} src`, `setsid grep -rn ${m} src`,
            // Sibling command strings do not add up to a nesting depth.
            `git -c alias.x='!echo hi' x; `.repeat(51) + `grep ${m} f`,
            // A dot-directory or a directory component that ends like a name is a path, even in a judged value or loop list (#144).
            `CLAUDE_CONFIG_DIR=$HOME/.${m} claude plugin list`, `CLAUDE_CONFIG_DIR="$HOME/.${m}" claude -p hi`, `CLAUDE_CONFIG_DIR=.${m} claude -p hi`,
            `export CLAUDE_CONFIG_DIR=~/.${m}`, `P=/Users/x/.${m}/plugins; ls "$P"`, `for d in ~/.claude ~/.${m}; do f=$d/x; python3 -c "print(1)"; done`,
            `cd ~/.${m} && claude plugin list`, `ls ~/.${m}/plugins`, `claude --plugin-dir ~/.${m}/plugins -p hi`, `python sync.py ~/.claude ~/.${m}/`,
            `python run.py --out results/${m}/out.json`, `python run.py > results/${m}/out.json`, `cat > notes.md <<'EOF'\nProfiles live in ~/.${m}/plugins.\nEOF`,
        ],
        // Text a command writes into a file is checked with every pattern, as advisory context.
        written: [
            `cat > s.json <<'EOF'\n{"models": {"claude": [["${m}", 0.6]]}}\nEOF`, `cat > usage.jsonl <<'EOF'\n{"model": "${m}", "tokens": 120}\nEOF`,
            `cat > app.py <<'EOF'\nDEFAULT = "${m}"\nEOF`, `cat > config.yaml <<'EOF'\nmodel: ${m}\nEOF`, `sed -i 's/NEW/${m}/' app.py`,
            `echo '{"model": "${m}"}' >> usage.jsonl`, `tee notes.md <<'EOF'\n--model ${m}\nEOF`, `git commit -F - <<'EOF'\nfix: replace model=${m}\nEOF`,
            `git commit -m "$(cat <<'EOF'\nfix: drop ${m} (it's retired)\nEOF\n)"`, `gh pr create --title x --body-file - <<'EOF'\nmodel=${m} is retired\nEOF`,
            // An in-place edit writes the file named after its options.
            `sed -Ei 's/NEW/${m}/' app.py`, `sed -ri 's/NEW/${m}/' app.py`, `sed 's/NEW/${m}/' -i app.py`, `sed -e 's/NEW/${m}/' -i app.py`,
            `sed --in-place 's/NEW/${m}/' app.py`, `sed -i.bak 's/NEW/${m}/' app.py`, `gsed -i 's/NEW/${m}/' app.py`, `yq -i '.model = "${m}"' config.yaml`,
            `yq e -i '.llm.model = "${m}"' config.yaml`, `awk -i inplace '{gsub(/NEW/,"${m}")}1' app.py`,
            `find src -name '*.py' -exec sed -Ei 's/NEW/${m}/g' {} +`, `rg -l NEW | xargs sed -Ei 's/NEW/${m}/g'`,
            // block_emoji counts a here-string as a write, so a data loop fed by one warns.
            `while read m; do grep -c "$m" usage.jsonl; done <<< "${m}"`,
            // A redirection target is not a selection, but the redirection writes a file.
            `python run.py > results/${m}`,
            // The replacement of an s/old/new/ substitution is text written into the file, not a directory.
            `sed -i '/^model:/s/NEW/${m}/g' config.yaml`, `sed -i 's/NEW/v-${m}/' app.py`,
        ],
        // A flag, setting, positional name, API body or interpreter code on a command that runs something selects the model.
        selected: [
            `python run.py --model "${m}"`, `python run.py --model ${m}`, `python run.py --model=${m}`, `python run.py "--model=${m}"`, `python run.py --model '${m}'`,
            `python run.py --model ${m},`, `python run.py --model ${m} > out.log 2>&1`, `codex exec -m ${m} "fix it"`, `codex -m ${m}`, `codex exec --model=${m} "x"`,
            `codex -c model=${m} exec "x"`, `codex -c 'model="${m}"' exec "x"`, `claude --model ${m} -p hi`, `claude -p hi --fallback-model ${m}`,
            `claude -p hi --model anthropic/${m}`, `llm -m ${m} "hi"`, `llm -m '${m}' "hi"`, `gemini -m ${m} -p hi`, `aider --model ${m}`, `aider --model openai/${m}`,
            `llm -m openrouter/openai/${m} hi`, `opencode run -m openai/${m} "hi"`, `OPENAI_MODEL=${m} python app.py`, `export ANTHROPIC_MODEL=${m}`,
            `env ANTHROPIC_MODEL=${m} claude -p hi`, `sudo -E python run.py --model ${m}`, `timeout 60 codex exec -m ${m} "x"`, `nohup python serve.py --model ${m} &`,
            `echo prompt | llm -m ${m}`, `echo start && llm -m ${m} hi`, `grep x file; claude --model ${m}`, `cat prompt.txt | xargs -0 llm -m ${m}`,
            `result=$(llm -m ${m} "hi")`, `out=$(python run.py --model ${m})`, `(python run.py --model ${m})`, `(cd app && python run.py --model=${m})`,
            `x=\`llm --model ${m}\``, `echo "$(llm -m ${m} 'hi')"`, `echo $(codex exec -m ${m} 'x')`, `git commit -m "$(llm -m ${m} 'write a commit message')"`,
            `echo '{"model":"${m}","messages":[]}' | curl -d @- https://api.example.invalid`, `jq -n '{model:"${m}",messages:[]}' | curl -d @- https://api.example.invalid`,
            `printf '{"model":"%s"}' ${m} | curl -d @- https://api.example.invalid`, `echo hi && curl https://api.example.invalid -d '{"model": "${m}"}'`,
            `curl -d '{"model":"${m}"}' https://api.example.invalid`, `curl -d "{\\"model\\": \\"${m}\\"}" https://api.example.invalid`,
            `curl -d '{"model":"openai/${m}"}' https://api.example.invalid`, `curl -d @- https://api.example.invalid <<'EOF'\n{"model": "${m}", "messages": []}\nEOF`,
            `python - <<'EOF'\nfrom openai import OpenAI\nOpenAI().chat.completions.create(model="${m}", messages=[])\nEOF`,
            `python3 <<EOF\nimport anthropic\nanthropic.Anthropic().messages.create(model="${m}", max_tokens=10, messages=[])\nEOF`,
            `cat <<'EOF' | python run.py --model ${m}\nprompt\nEOF`, `python -c "client.create(model='${m}')"`,
            `python -c "from openai import OpenAI; OpenAI().chat.completions.create(model='openai/${m}', messages=[])"`,
            `uv run python -c "import llm; llm.get_model('${m}').prompt('hi')"`, `python eval.py ${m}`, `python eval.py --models ${m},other`,
            `python eval.py --judge-model ${m}`, `python eval.py --model-name ${m}`, `python eval.py --model_name=${m}`, `ollama run ${m}`,
            `python run.py \\\n  --model ${m}`, `x=$((1<<4))\npython run.py --model ${m}`, `grep foo f # don't\npython run.py --model ${m}`, `echo "<<END"\nllm -m ${m} hi`,
            `find . -name '*.json' -exec python run.py --model ${m} {} \\;`, `gh models run openai/${m} "hi"`, `perl -pi -e 's/NEW/${m}/' app.py`,
            `for m in ${m} other; do python run.py --model $m; done`, `while read l; do echo $l; done < <(llm -m ${m} "list")`, `MODEL=${m}`,
            // A value printed into a variable, a loop or a compound command reaches the command that runs.
            `BODY=$(jq -n '{model:"${m}",messages:[]}'); curl -d "$BODY" https://api.example.invalid`,
            `BODY=$(printf '{"model":"%s"}' ${m}) && curl -d "$BODY" https://api.example.invalid`, `MODEL=$(echo ${m}); python run.py --model "$MODEL"`,
            `for m in $(echo ${m} other); do python run.py --model "$m"; done`, `for m in $(printf '%s\\n' ${m}); do llm -m "$m" hi; done`,
            `X="$(cat <<'EOF'\n{"model": "${m}", "messages": []}\nEOF\n)"; curl -d "$X" https://api.example.invalid`, `read -r MODEL <<< "${m}"; llm -m "$MODEL" hi`,
            `{ echo '{"model": "${m}",'; echo '"messages": []}'; } | curl -d @- https://api.example.invalid`,
            `(echo '{"model":"${m}"}'; echo) | curl -d @- https://api.example.invalid`, `(echo '{"model":"${m}"}') | curl -d @- https://api.example.invalid`,
            `if true; then echo '{"model":"${m}"}'; fi | curl -d @- https://api.example.invalid`,
            `for i in 1; do printf '{"model":"%s"}' ${m}; done | curl -d @- https://api.example.invalid`,
            `while read m; do llm -m "$m" hi; done < <(echo ${m})`, `while read m; do llm -m "$m" hi; done <<'EOF'\n${m}\nEOF`,
            `while read m; do llm -m "$m" hi; done <<< "${m}"`, `echo ${m} | while read m; do llm -m "$m" hi; done`,
            // A pytest option other than a test filter, and a gh or git subcommand that runs or dispatches something.
            `pytest tests/test_llm.py --model ${m}`, `pytest evals/ --model=${m} -q`, `uv run pytest evals --llm-model ${m}`,
            `python -m pytest evals --model ${m}`, `python -m pytest -k x --model ${m}`, `gh workflow run eval.yml -f model=${m}`,
            `gh api -X POST repos/o/r/actions/workflows/eval.yml/dispatches -f ref=main -f inputs[model]=${m}`,
            `gh variable set OPENAI_MODEL --body ${m}`, `gh secret set MODEL --body ${m}`, `gh "models" run ${m} hi`,
            `git bisect run python eval.py --model ${m}`, `git rebase -x "python eval.py --model ${m}" HEAD~3`,
            `git rebase --exec="python eval.py --model ${m}" HEAD~3`, `git submodule foreach 'python run.py --model ${m}'`,
            `git -c alias.x='!llm -m ${m} hi' x`, `git -c core.pager='llm -m ${m}' log -1`,
            `fd -e json -x python run.py --model ${m} {}`, `fd -e json --exec python run.py --model ${m}`, `sudo --user git python run.py --model ${m}`,
            `env --unset cat python run.py --model ${m}`, `echo \${x:-$(llm -m ${m} hi)}`, `echo "\${x:-$(python run.py --model ${m})}"`,
            `echo $[1<<2]\npython run.py --model ${m}`,
            // A loop or group that only prints its list or input, piped into a command that runs.
            `for m in ${m} other; do echo "$m"; done | xargs -I{} llm -m {} hi`, `for m in ${m}; do echo "$m"; done | parallel llm -m {} hi`,
            `(for m in ${m}; do echo "$m"; done) | xargs llm -m`, `{ for m in ${m}; do echo "$m"; done; } | xargs llm -m`,
            `while read -r m; do echo "$m"; done < <(echo ${m}) | xargs -I{} llm -m {} hi`,
            `while read m; do echo "$m"; done <<< "${m}" | xargs -I{} llm -m {} hi`,
            `while read m; do echo "$m"; done <<'EOF' | xargs -I{} llm -m {} hi\n${m}\nEOF`,
            `{ cat; } <<'EOF' | curl -d @- https://api.example.invalid\n{"model": "${m}"}\nEOF`,
            `printf -v MODEL '%s' ${m}; llm -m "$MODEL" hi`, `set -- ${m} other; llm -m "$1" hi`,
            `pytest tests/ -p evalplugin --llm ${m}`, `python -m pytest tests/ -o llm_model=${m}`, `pytest -k x --model ${m} tests/`,
            `pytest evals --model openai/${m}`, `pytest -k x --model=${m}`,
            `echo '{"event_type":"eval","client_payload":{"model":"${m}"}}' | gh api -X POST repos/o/r/dispatches --input -`,
            `gh api -X POST repos/o/r/dispatches --input - <<< '{"client_payload":{"model":"${m}"}}'`,
            `time -p python run.py --model ${m}`, `ionice -c3 python run.py --model ${m}`, `setsid python run.py --model ${m}`,
            // Bash joins quoted pieces of one word, so a name split by quotes is still that name.
            `python run.py --model ${m.slice(0, 2)}"${m.slice(2)}"`, `python run.py --model '${m.slice(0, 2)}''${m.slice(2)}'`,
            // A provider prefix, a Bedrock model id and punctuation after the name still select it, and a profile path does not hide a later selection.
            `ANTHROPIC_MODEL=${m} claude -p hi`, `ANTHROPIC_MODEL=anthropic/${m} claude -p hi`, `llm -m bedrock/${m} hi`,
            `aws bedrock-runtime invoke-model --model-id anthropic.${m} out.json`, `ollama run ${m}:latest`, `python run.py --model ${m};`,
            `python -c "client.messages.create(model='${m}')"`, `CLAUDE_CONFIG_DIR=~/.${m} claude --model ${m} -p hi`,
            `perl -pi -e 's/NEW/v-${m}/g' app.py`,
        ],
    };
}
/** A blocking name that no bare-name pattern recognises, so only a model flag or setting can find it. */
export const unprefixedSample = () => [...getAllModelNames()].find(name => { const [old, info] = checkModelStatus(name); return old && !info?.warn_only && !/^(?:gpt-|claude-|gemini-|qwen|kimi-k|deepseek-v|glm-|solar-|kanana-|exaone-|k-exaone-)/.test(name); })!;
/** Inputs outside the verdict lists whose only expectation is that both twins agree. */
export function parityCases(m: string): string[] {
    const u = unprefixedSample();
    return [
        `python -c "print('${m}')"`, `python run.py --model ${u}`, `python run.py --model\u001f${u}`, `python run.py --model\ufeff${u}`,
        `python run.py --model\u0085${u}`, `python run.py model\u001c="${u}"`, `python run.py model\ufeff= "${u}"`, `python run.py model="${u}\ufeff"`,
        'echo ' + '$('.repeat(2000) + `llm -m ${m}` + ')'.repeat(2000), '$('.repeat(300) + `llm -m ${m}` + ')'.repeat(300),
        `echo $(llm -m ${m}`, `python - <<EOF\nclient.create(model="${m}")`, 'cat <<', 'echo ${', '(((', ')))))',
        // Path-segment edges: the start of the text, a dot after a letter, a substitution split by a newline and an address before s.
        `.${m}`, `${m}/`, `python run.py x.${m} ~.${m} \u00e9.${m} 1s/x/${m}/ s/\n/${m}/ /s/x/${m}/y`, `python - <<EOF\nPATH = '/.${m}/'\nEOF`,
    ];
}
