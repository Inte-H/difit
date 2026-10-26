package demo;

import java.util.function.Function;

public interface MemberRepository extends Function<Long, String> {
    @Override
    String apply(Long id);
}
